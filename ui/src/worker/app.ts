// The whole cloud service: the sync routes for whoever pushes, the review page and its routes for
// whoever looks, and kept built Storybooks on an origin of their own. See docs/specs/cloud.md.
import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { Blobs, BuiltStorybooks, initStoreSchema, ReceivingStore, RenderBatches, Sql, StoredDiffs, type Comparison } from "selfie-store";
import { D1BindingAdapter, type D1DatabaseLike } from "selfie-store/adapters/d1-binding";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { createReviewApi, pageHeaders, sameOrigin, sameOriginWrites } from "../server/app.ts";
import { hostedReviewSource, hostedViews, type HostedProject } from "../server/hosted.ts";
import { afterResponse, errorCodes } from "../server/http.ts";
import { keptStorybookRoutes, storybookHeaders } from "../server/storybook.ts";
import { createSyncApi, type SyncAccess, type SyncProject } from "../server/sync.ts";
import { commitStatusOf } from "../shared/commit-status.ts";
import { sameSecret, WRITER } from "./auth.ts";
import type { GitHub } from "./github.ts";
import { localPath, type Login } from "./login.ts";

export interface CloudProject {
  /** The repository's numeric ID. */
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  /** What the repository was called before, each answered with a redirect to its name now. */
  readonly formerNames?: readonly string[];
  readonly defaultBranch: string;
  readonly db: D1DatabaseLike;
}

export interface CloudConfig {
  readonly projects: readonly CloudProject[];
  readonly bucket: R2BucketLike;
  readonly reviewOrigin: string;
  readonly storybookOrigin: string;
  /** Where this service used to be, each answered with a permanent redirect to `reviewOrigin`, method and all. */
  readonly formerOrigins?: readonly string[];
  /** Signing in through GitHub, which only the writer can do. */
  readonly login: Login;
  /** What the writer's own `selfie push` and `selfie approve` sync with, as a bearer token. */
  readonly writerToken: string;
  /** What CI uploads with, which can't approve anything. */
  readonly uploadToken: string;
  readonly github: GitHub;
  /** The built client's files. */
  readonly assets: { fetch(request: Request): Promise<Response> };
  readonly now?: () => number;
}

const signInPage = (next: string, failed: boolean, code: string | null) => html`<!doctype html>
  <html lang="en">
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Selfie</title>
    <body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px">
      <h1 style="font-size:22px">Sign in to Selfie</h1>
      ${failed ? html`<p role="alert" style="color:#b35900">GitHub didn't sign you in. Try again.${code === null ? "" : html`<br />Error code: ${code}`}</p>` : ""}
      <form method="post">
        <input type="hidden" name="next" value="${next}" />
        <button style="font-size:16px;padding:8px 16px">Sign in with GitHub</button>
      </form>
    </body>
  </html>`;

/** How many later commits a decision says the status of again, besides its own. See docs/specs/cloud.md -> Commit status. */
const MAX_STATUSES_REACHING = 50;

/** Its one form posts here, and is answered with a redirect to GitHub, which `form-action` also governs. */
const SIGN_IN_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'";

export function createCloudApp(config: CloudConfig): Hono {
  const { github, projects, bucket, login, writerToken, uploadToken, reviewOrigin, storybookOrigin } = config;
  const now = config.now ?? Date.now;
  const storybookHost = new URL(storybookOrigin).host;

  /** Each project's store, kept for a Worker's life, along with what it holds on to of kept built Storybooks. */
  const open = (project: CloudProject) => {
    const sql = new Sql(new D1BindingAdapter(project.db));
    const blob = new Blobs(new R2BlobStorage({ bucket, project: project.id }));
    const hosted: HostedProject = {
      batches: new RenderBatches({ sql }),
      storybooks: new BuiltStorybooks({ sql, blob }),
      store: new ReceivingStore({ sql, blob }),
      diffs: new StoredDiffs(blob),
      name: project.name,
      defaultBranch: project.defaultBranch,
      storybookBase: `${storybookOrigin}/${project.id}`,
    };
    // Whether it's done, and never the setting up itself, since a request waiting on another's would
    // wait forever if that one were canceled. Two first requests may both set it up, which is harmless.
    let schemaReady = false;
    return {
      project,
      hosted,
      views: hostedViews(hosted),
      /** Sets up its database until that's worked once. */
      ready: async () => {
        if (schemaReady) return;
        await initStoreSchema(sql);
        schemaReady = true;
      },
    };
  };
  type Opened = ReturnType<typeof open>;
  const opened = projects.map(open);
  const byId = (id: string | undefined) => opened.find(({ project }) => project.id === id);
  const byName = (owner: string | undefined, name: string | undefined) =>
    opened.find(({ project }) => project.owner === owner && (project.name === name || project.formerNames?.includes(name ?? "") === true));

  /** Says what a commit reads as where people look. A person's decision stands whether or not GitHub hears of it. */
  const publish = async ({ project, hosted: { batches } }: Opened, gitSha: string, environment: string, known?: Comparison) => {
    try {
      const newest = (await batches.batchesAt(gitSha, environment)).find(({ status }) => status !== "recording");
      if (newest === undefined) return;
      const comparison = known?.batch.id === newest.id ? known : await batches.compareReached(newest.id);
      await github.postStatus(project, gitSha, commitStatusOf(comparison), `${reviewOrigin}/${project.owner}/${project.name}/batches/${newest.id}`);
    } catch (error) {
      console.error(error);
    }
  };

  /**
   * After a decision, says again what its commit reads as, then each later commit with a batch here whose history
   * reaches it, newest first, since what they're compared with may have changed too. Up to a bound, after answering.
   */
  const publishDecided = async (found: Opened, comparison: Comparison) => {
    const { gitSha, environment } = comparison.batch;
    await publish(found, gitSha, environment, comparison);
    const reaching = await found.hosted.batches.batchesReaching(gitSha, environment, MAX_STATUSES_REACHING).catch((error: unknown) => {
      console.error(error);
      return [];
    });
    for (const later of reaching) await publish(found, later.gitSha, environment);
  };

  const accessOf = async (token: string | null): Promise<SyncAccess> => {
    if (token !== null && (await sameSecret(token, writerToken))) return { view: true, upload: true, decider: WRITER };
    if (token !== null && (await sameSecret(token, uploadToken))) return { view: true, upload: true, decider: null };
    // Every project here is public.
    return { view: true, upload: false, decider: null };
  };

  // A built Storybook is the code of whatever branch was built, so it never shares an origin with what can approve.
  const storybooks = new Hono();
  storybooks.use(storybookHeaders(() => [reviewOrigin]));
  storybooks.route("/:project", keptStorybookRoutes((build, file, context) => byId(context.req.param("project"))?.hosted.storybooks.readFile(build, file) ?? Promise.resolve(null)));
  storybooks.all("*", (context) => context.text("Not found.", 404));

  const reviewHost = new URL(reviewOrigin).host;
  const formerHosts = new Set((config.formerOrigins ?? []).map((origin) => new URL(origin).host));
  const app = new Hono();
  // First, so it sees every answer, from every origin.
  app.use("*", errorCodes);
  // Without Hono's own logging, since `errorCodes` logs it under the code the person sees.
  app.onError((_error, context) => context.text("Something went wrong in the Selfie server.", 500));
  app.use("*", async (context, next) => {
    const url = new URL(context.req.url);
    if (url.host === storybookHost) return storybooks.fetch(context.req.raw);
    // 308, so a `selfie push` still pointed at an old origin sends its body again.
    if (formerHosts.has(url.host)) return context.redirect(`${reviewOrigin}${url.pathname}${url.search}`, 308);
    // Any other name for this Worker, such as its workers.dev one, is never an alias for the review origin.
    if (url.host !== reviewHost) return context.text("Unknown origin.", 421);
    return next();
  });

  app.get("/", (context) => context.redirect(`/${projects[0]!.owner}/${projects[0]!.name}`));

  const signInPolicy = async (context: Context, next: () => Promise<void>) => {
    context.header("Content-Security-Policy", SIGN_IN_POLICY);
    await next();
  };
  app.get("/sign-in", signInPolicy, (context) => {
    const failed = context.req.query("failed");
    // Only a code the callback could have made, since anyone can link here with anything after `failed=`.
    const code = failed !== undefined && /^[0-9A-Z]{8}$/.test(failed) ? failed : null;
    return context.html(signInPage(localPath(context.req.query("next")), failed !== undefined, code), failed !== undefined ? 401 : 200);
  });
  app.post("/sign-in", signInPolicy, sameOrigin(() => reviewOrigin), async (context) => {
    const form = await context.req.parseBody();
    return login.begin(context.req.raw, localPath(form.next));
  });
  // GitHub's redirect back is the one route of the auth adapter that anything outside the Worker reaches.
  app.get("/api/auth/callback/github", (context) => login.callback(context.req.raw));
  app.get("/signed-in", (context) => login.landed(context.req.raw));
  app.post("/sign-out", sameOrigin(() => reviewOrigin), (context) => login.signOut(context.req.raw));

  app.route(
    "/api",
    createSyncApi({
      now,
      async open(id, token) {
        const found = byId(id);
        if (found === undefined) return null;
        await found.ready();
        const { batches, store, storybooks: kept, diffs } = found.hosted;
        return {
          access: await accessOf(token),
          defaultBranch: found.project.defaultBranch,
          batches,
          store,
          storybooks: kept,
          diffs,
          hasCommit: (sha) => github.hasCommit(found.project, sha),
          commitChanged: (gitSha, environment) => publish(found, gitSha, environment),
        } satisfies SyncProject;
      },
      findProject: async (owner, name) => byName(owner, name)?.project.id ?? null,
    }),
  );

  app.get("/assets/*", (context) => config.assets.fetch(context.req.raw));

  const knownProject = async (context: Context, next: () => Promise<void>) => {
    const { owner, repo } = context.req.param() as { owner: string; repo: string };
    const found = byName(owner, repo);
    if (found === undefined) return context.text("No such project.", 404);
    if (found.project.name !== repo) {
      const url = new URL(context.req.url);
      return context.redirect(`/${owner}/${found.project.name}${url.pathname.slice(`/${owner}/${repo}`.length)}${url.search}`, 308);
    }
    return next();
  };
  const reviewHeaders = pageHeaders(storybookOrigin);

  app.use("/:owner/:repo/api/*", knownProject, reviewHeaders, sameOriginWrites(() => reviewOrigin));
  const readyProject = async (context: Context) => {
    const found = byName(context.req.param("owner"), context.req.param("repo"))!;
    await found.ready();
    return found;
  };
  app.route(
    "/:owner/:repo/api",
    createReviewApi(async (context) => {
      const found = await readyProject(context);
      return hostedReviewSource(found.hosted, found.views, {
        actor: await login.writerOf(context.req.raw),
        decided: (comparison) => afterResponse(context, publishDecided(found, comparison)),
      });
    }),
  );

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
