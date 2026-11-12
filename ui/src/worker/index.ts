// The Worker at app.selfie.dev. Which projects it hosts is written down here, since there are
// only ever going to be a few, all public, and all Ned's. See docs/specs/cloud.md.
import { createBetterAuthWorker } from "@pgstencil/auth/better-auth-workers";
import type { ExecutionContext, Hono } from "hono";
import type { D1DatabaseLike } from "selfie-store/adapters/d1-binding";
import type { R2BucketLike } from "selfie-store/adapters/r2";
import { createCloudApp } from "./app.ts";
import { WRITER, WRITER_GITHUB_ID } from "./auth.ts";
import { metaModel } from "./chat.ts";
import { githubApp } from "./github.ts";
import { ERROR_PATH, pgstencilLogin, SUCCESS_PATH } from "./login.ts";

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly BLOBS: R2BucketLike;
  readonly DB_1183663019: D1DatabaseLike;
  readonly DB_1442175397: D1DatabaseLike;
  readonly DB_1445291541: D1DatabaseLike;
  /** Postgres, through an uncached Hyperdrive, holding only sign-in's users, accounts, and sessions. */
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly APP_ORIGIN: string;
  readonly STORYBOOK_ORIGIN: string;
  /** Where this service used to be, each answered with a permanent redirect to `APP_ORIGIN`. */
  readonly FORMER_ORIGINS: string;
  readonly AUTH_SECRET: string;
  /** The GitHub App's own OAuth client, which signing in uses. */
  readonly GITHUB_CLIENT_ID: string;
  readonly GITHUB_CLIENT_SECRET: string;
  readonly SELFIE_WRITER_TOKEN: string;
  readonly SELFIE_UPLOAD_TOKEN: string;
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_PRIVATE_KEY: string;
  readonly MODEL_API_KEY: string;
  readonly CHAT_LIMIT: { limit(request: { readonly key: string }): Promise<{ readonly success: boolean }> };
}

/** Only these reach the auth adapter, so no other secret is ever in its hands. */
type AuthEnv = Pick<Env, "HYPERDRIVE" | "APP_ORIGIN" | "AUTH_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET">;

const auth = createBetterAuthWorker<AuthEnv>({
  appName: "Selfie",
  sessionPolicy: "multiple",
  accountLinking: "explicit",
  allowMissingEmail: true,
  rememberLoginMethod: false,
  successPath: SUCCESS_PATH,
  errorPath: ERROR_PATH,
  // There's no email sign-in: the Worker never routes its requests to the adapter, and this sends nothing.
  email: () => ({
    send: async () => {
      throw new Error("Selfie has no email sign-in");
    },
  }),
});

/** Once per Worker's life, which is what lets a project's caches and a GitHub token last between requests. */
let app: Hono | null = null;

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    const authEnv: AuthEnv = {
      HYPERDRIVE: env.HYPERDRIVE,
      APP_ORIGIN: env.APP_ORIGIN,
      AUTH_SECRET: env.AUTH_SECRET,
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    };
    app ??= createCloudApp({
      projects: [
        { id: "1442175397", owner: "diffplug", name: "selfie", formerNames: ["selfie-hackathon"], defaultBranch: "main", db: env.DB_1442175397 },
        { id: "1445291541", owner: "diffplug", name: "selfie-sandbox", defaultBranch: "main", db: env.DB_1445291541 },
        { id: "1183663019", owner: "diffplug", name: "dormouse", defaultBranch: "main", db: env.DB_1183663019 },
      ],
      bucket: env.BLOBS,
      reviewOrigin: env.APP_ORIGIN,
      storybookOrigin: env.STORYBOOK_ORIGIN,
      formerOrigins: env.FORMER_ORIGINS.split(/\s+/).filter(Boolean),
      login: pgstencilLogin({
        origin: env.APP_ORIGIN,
        // The adapter opens and closes its own database connection on each request.
        auth: async (inner) => auth.fetch(inner, authEnv),
        writerGithubId: WRITER_GITHUB_ID,
        writerName: WRITER,
      }),
      writerToken: env.SELFIE_WRITER_TOKEN,
      uploadToken: env.SELFIE_UPLOAD_TOKEN,
      github: githubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY }),
      model: metaModel({ apiKey: env.MODEL_API_KEY }),
      mayChat: async (client) => (await env.CHAT_LIMIT.limit({ key: client })).success,
      assets: env.ASSETS,
    });
    return app.fetch(request, env, context);
  },
};
