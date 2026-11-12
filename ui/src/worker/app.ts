// The whole cloud service: the sync routes for whoever pushes, the review page and its routes for
// whoever looks, and kept built Storybooks on an origin of their own. See docs/specs/cloud.md.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { Blobs, BuiltStorybooks, initStoreSchema, ReceivingStore, RenderBatches, Sql, StoredDiffs, type Comparison } from "selfie-store";
import { D1BindingAdapter, type D1DatabaseLike } from "selfie-store/adapters/d1-binding";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { createReviewApi, failure, pageHeaders, sameOrigin, sameOriginWrites } from "../server/app.ts";
import { hostedReviewSource, hostedViews, type HostedProject } from "../server/hosted.ts";
import { afterResponse } from "../server/http.ts";
import { keptStorybookRoutes, storybookHeaders } from "../server/storybook.ts";
import { createSyncApi, type SyncAccess, type SyncProject } from "../server/sync.ts";
import { commitStatusOf } from "../shared/commit-status.ts";
import { sameSecret, WRITER } from "./auth.ts";
import { createChat, MAX_CHAT_BYTES, type ChatModel } from "./chat.ts";
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
  readonly model: ChatModel;
  /** Whether whoever this is may ask the model something now. */
  readonly mayChat: (client: string) => Promise<boolean>;
  /** The built client's files. */
  readonly assets: { fetch(request: Request): Promise<Response> };
  readonly now?: () => number;
}

const signInPage = (next: string, problem: "failed" | "refused" | null) => html`<!doctype html>
  <html lang="en">
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Selfie</title>
    <body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px">
      <h1 style="font-size:22px">Sign in to Selfie</h1>
      ${problem === "failed" ? html`<p role="alert" style="color:#b35900">GitHub didn't sign you in. Try again.</p>` : ""}
      ${problem === "refused" ? html`<p role="alert" style="color:#b35900">For now, only @${WRITER} can sign in. Anyone can look around without signing in.</p>` : ""}
      <form method="post">
        <input type="hidden" name="next" value="${next}" />
        <button style="font-size:16px;padding:8px 16px">Sign in with GitHub</button>
      </form>
    </body>
  </html>`;

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
    let schema: Promise<void> | null = null;
    return {
      project,
      hosted,
      views: hostedViews(hosted),
      /** Sets up its database once, or tries again next time if that failed. */
      ready: () => {
        schema ??= initStoreSchema(sql).catch((error: unknown) => {
          schema = null;
          throw error;
        });
        return schema;
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
    const problem = context.req.query("refused") !== undefined ? "refused" : context.req.query("failed") !== undefined ? "failed" : null;
    return context.html(signInPage(localPath(context.req.query("next")), problem), problem === null ? 200 : 401);
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
  const chat = createChat({ github, model: config.model, mayChat: config.mayChat });
  app.route(
    "/:owner/:repo/api",
    createReviewApi(
      async (context) => {
        const found = await readyProject(context);
        return hostedReviewSource(found.hosted, found.views, {
          actor: await login.writerOf(context.req.raw),
          decided: (comparison) => afterResponse(context, publish(found, comparison.batch.gitSha, comparison.batch.environment, comparison)),
        });
      },
      (api) =>
        api.post("/batches/:batchId/chat", bodyLimit({ maxSize: MAX_CHAT_BYTES, onError: (context) => context.json(failure("bad-request", "That's more than a question can hold."), 400) }), async (context) => {
          const { project, hosted } = await readyProject(context);
          return chat(context, project, hosted);
        }),
    ),
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
