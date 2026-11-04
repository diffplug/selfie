// The Worker at hackathon.selfie.dev. Which projects it hosts is written down here, since there are
// only ever going to be a few, all public, and all Ned's. See docs/specs/cloud.md.
import type { ExecutionContext, Hono } from "hono";
import type { D1DatabaseLike } from "selfie-store/adapters/d1-binding";
import type { R2BucketLike } from "selfie-store/adapters/r2";
import { createCloudApp } from "./app.ts";
import { githubApp } from "./github.ts";

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly BLOBS: R2BucketLike;
  readonly DB_1442175397: D1DatabaseLike;
  readonly DB_1445291541: D1DatabaseLike;
  readonly REVIEW_ORIGIN: string;
  readonly STORYBOOK_ORIGIN: string;
  readonly SELFIE_WRITER_PASSWORD: string;
  readonly SELFIE_UPLOAD_TOKEN: string;
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_PRIVATE_KEY: string;
}

/** Once per Worker's life, which is what lets a project's caches and a GitHub token last between requests. */
let app: Hono | null = null;

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    app ??= createCloudApp({
      projects: [
        { id: "1442175397", owner: "diffplug", name: "selfie-hackathon", defaultBranch: "main", db: env.DB_1442175397 },
        { id: "1445291541", owner: "diffplug", name: "selfie-sandbox", defaultBranch: "main", db: env.DB_1445291541 },
      ],
      bucket: env.BLOBS,
      reviewOrigin: env.REVIEW_ORIGIN,
      storybookOrigin: env.STORYBOOK_ORIGIN,
      password: env.SELFIE_WRITER_PASSWORD,
      uploadToken: env.SELFIE_UPLOAD_TOKEN,
      github: githubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY }),
      assets: env.ASSETS,
    });
    return app.fetch(request, env, context);
  },
};
