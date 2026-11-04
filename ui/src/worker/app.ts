// The whole cloud service: the sync routes for whoever pushes, the review page and its routes for
// whoever looks, and kept built Storybooks on an origin of their own. See docs/specs/cloud.md.
import { Hono, type Context } from "hono";
import { Blobs, BuiltStorybooks, initStoreSchema, ReceivingStore, RenderBatches, Sql, StoredDiffs } from "selfie-store";
import { D1BindingAdapter, type D1DatabaseLike } from "selfie-store/adapters/d1-binding";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { createReviewApi, pageHeaders, sameOriginWrites } from "../server/app.ts";
import { hostedReviewSource } from "../server/hosted.ts";
import { keptStorybookRoutes, storybookHeaders } from "../server/storybook.ts";
import { createSyncApi, type SyncAccess, type SyncProject } from "../server/sync.ts";
import { commitStatusOf } from "../shared/commit-status.ts";
import { actorFromCookie, sameSecret, sessionCookie, WRITER } from "./auth.ts";
import type { GitHub } from "./github.ts";

export interface CloudProject {
  /** The repository's numeric ID. */
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly db: D1DatabaseLike;
}

export interface CloudConfig {
  readonly projects: readonly CloudProject[];
  readonly bucket: R2BucketLike;
  readonly reviewOrigin: string;
  readonly storybookOrigin: string;
  readonly password: string;
  /** What CI uploads with, which can't approve anything. */
  readonly uploadToken: string;
  readonly github: GitHub;
  /** The built client's files. */
  readonly assets: { fetch(request: Request): Promise<Response> };
  readonly now?: () => number;
}

/** Each project's own database is set up once in a Worker's life. */
const initialized = new WeakMap<D1DatabaseLike, Promise<void>>();

function openProject(project: CloudProject, bucket: R2BucketLike) {
  const sql = new Sql(new D1BindingAdapter(project.db));
  const blob = new Blobs(new R2BlobStorage({ bucket, project: project.id }));
  return {
    ready: async () => {
      let done = initialized.get(project.db);
      if (done === undefined) {
        done = initStoreSchema(sql);
        initialized.set(project.db, done);
        done.catch(() => initialized.delete(project.db));
      }
      await done;
    },
    batches: new RenderBatches({ sql }),
    storybooks: new BuiltStorybooks({ sql, blob }),
    store: new ReceivingStore({ sql, blob }),
    diffs: new StoredDiffs(blob),
  };
}

const signInPage = (next: string, wrong: boolean) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Selfie</title>
<body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">Sign in to Selfie</h1>
${wrong ? '<p role="alert" style="color:#b35900">That isn\'t the password.</p>' : ""}
<form method="post"><input type="hidden" name="next" value="${next.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">
<label>Password <input type="password" name="password" autocomplete="current-password" autofocus required style="display:block;width:100%;margin:8px 0 16px;font-size:16px;padding:8px;box-sizing:border-box"></label>
<button style="font-size:16px;padding:8px 16px">Sign in</button></form>`;

const SIGN_IN_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** Only somewhere on this site, so a link can't send someone off it after signing in. */
const localPath = (next: unknown) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function createCloudApp(config: CloudConfig): Hono {
  const { github, projects, bucket, password, uploadToken, reviewOrigin, storybookOrigin } = config;
  const now = config.now ?? Date.now;
  const byId = new Map(projects.map((project) => [project.id, project]));
  const byName = (owner: string | undefined, name: string | undefined) => projects.find((project) => project.owner === owner && project.name === name);
  const storybookHost = new URL(storybookOrigin).host;
  const urlOfBatch = ({ owner, name }: CloudProject, batchId: string) => `${reviewOrigin}/${owner}/${name}/batches/${batchId}`;

  /** Says what a commit reads as where people look. A person's decision stands whether or not GitHub hears of it. */
  const publish = async (project: CloudProject, opened: ReturnType<typeof openProject>, gitSha: string, environment: string) => {
    try {
      const newest = (await opened.batches.batchesAt(gitSha, environment)).find(({ status }) => status !== "recording");
      if (newest === undefined) return;
      await github.postStatus(project, gitSha, commitStatusOf(await opened.batches.compareReached(newest.id)), urlOfBatch(project, newest.id));
    } catch (error) {
      console.error(error);
    }
  };

  const accessOf = async (token: string | null): Promise<SyncAccess> => {
    if (token !== null && (await sameSecret(token, password))) return { view: true, upload: true, decider: WRITER };
    if (token !== null && (await sameSecret(token, uploadToken))) return { view: true, upload: true, decider: null };
    // Every project here is public.
    return { view: true, upload: false, decider: null };
  };

  const refuseOtherSites = (context: Context) => {
    const origin = context.req.header("origin");
    return origin !== undefined && origin !== reviewOrigin ? context.text("This server doesn't answer other sites.", 403) : null;
  };

  const app = new Hono();

  // A built Storybook is the code of whatever branch was built, so it never shares an origin with what can approve.
  app.use("*", async (context, next) => {
    const url = new URL(context.req.url);
    if (url.host !== storybookHost) return next();
    const project = byId.get(url.pathname.split("/")[1] ?? "");
    if (project === undefined) return context.text("Not found.", 404);
    const opened = openProject(project, bucket);
    const stored = new Hono();
    stored.use(storybookHeaders(() => [reviewOrigin]));
    stored.route("/", keptStorybookRoutes((build, file) => opened.storybooks.readFile(build, file)));
    url.pathname = url.pathname.slice(`/${project.id}`.length);
    return stored.fetch(new Request(url, context.req.raw));
  });

  app.get("/", (context) => context.redirect(`/${projects[0]!.owner}/${projects[0]!.name}`));

  app.get("/sign-in", (context) => {
    context.header("Content-Security-Policy", SIGN_IN_POLICY);
    return context.html(signInPage(localPath(context.req.query("next")), false));
  });
  app.post("/sign-in", async (context) => {
    context.header("Content-Security-Policy", SIGN_IN_POLICY);
    const refused = refuseOtherSites(context);
    if (refused !== null) return refused;
    const form = await context.req.parseBody();
    const next = localPath(form.next);
    if (typeof form.password !== "string" || !(await sameSecret(form.password, password))) return context.html(signInPage(next, true), 401);
    context.header("Set-Cookie", await sessionCookie(password, now()));
    return context.redirect(next, 303);
  });

  const sync = createSyncApi({
    now,
    async open(id, token) {
      const project = byId.get(id);
      if (project === undefined) return null;
      const opened = openProject(project, bucket);
      await opened.ready();
      return {
        access: await accessOf(token),
        batches: opened.batches,
        store: opened.store,
        storybooks: opened.storybooks,
        diffs: opened.diffs,
        hasCommit: (sha) => github.hasCommit(project, sha),
        commitChanged: (gitSha, environment) => publish(project, opened, gitSha, environment),
      } satisfies SyncProject;
    },
    findProject: async (owner, name) => byName(owner, name)?.id ?? null,
  });
  app.route("/api", sync);

  app.get("/assets/*", (context) => config.assets.fetch(context.req.raw));

  const knownProject = async (context: Context, next: () => Promise<void>) => {
    if (byName(context.req.param("owner"), context.req.param("repo")) === undefined) return context.text("No such project.", 404);
    return next();
  };
  const reviewHeaders = pageHeaders(storybookOrigin);

  app.all("/:owner/:repo/api/*", knownProject, reviewHeaders, sameOriginWrites(() => reviewOrigin), async (context) => {
    const { owner, repo } = context.req.param() as { owner: string; repo: string };
    const project = byName(owner, repo)!;
    const opened = openProject(project, bucket);
    await opened.ready();
    const source = hostedReviewSource(
      { ...opened, name: project.name, defaultBranch: project.defaultBranch, storybookBase: `${storybookOrigin}/${project.id}` },
      {
        actor: await actorFromCookie(context.req.header("cookie"), password, now()),
        decided: (batch) => publish(project, opened, batch.gitSha, batch.environment),
      },
    );
    const url = new URL(context.req.url);
    url.pathname = url.pathname.slice(`/${owner}/${repo}/api`.length) || "/";
    return createReviewApi(source).fetch(new Request(url, context.req.raw));
  });

  // The client routes for itself, so any other page of a project is its one document, told where it is.
  const servePage = async (context: Context) => {
    const { owner, repo } = context.req.param() as { owner: string; repo: string };
    const page = await config.assets.fetch(new Request(new URL("/", context.req.url)));
    context.header("Cache-Control", "no-store");
    return context.html((await page.text()).replace("<head>", `<head><meta name="selfie-base" content="/${owner}/${repo}">`));
  };
  app.get("/:owner/:repo", knownProject, reviewHeaders, servePage);
  app.get("/:owner/:repo/*", knownProject, reviewHeaders, servePage);

  app.all("*", (context) => context.text("Not found.", 404));
  return app;
}

