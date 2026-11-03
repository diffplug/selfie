// The local half of the seam: which hosts may ask a server on this machine, and how Node serves it.
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import type { ReviewSource } from "../shared/api.ts";
import { createReviewApi, failure, pageHeaders, sameOriginWrites } from "./app.ts";
import { keptBuildRoutes, storybookHeaders, type BuildFileReader } from "./storybook.ts";

const LOOPBACK = "127.0.0.1";
const IMMUTABLE_ASSET = "public, max-age=31536000, immutable";

/** Where `vite build` puts the client. */
const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

/**
 * Refuses a request not addressed to this server by a loopback name, so a site that points its own
 * DNS name at 127.0.0.1 can't read anything. `port` is asked per request, since listening decides it.
 */
/** Both names this server answers to, since each is its own origin to a browser. */
const loopbackOrigins = (port: number): readonly string[] => [`http://${LOOPBACK}:${port}`, `http://localhost:${port}`];

function loopbackHosts(port: () => number): MiddlewareHandler {
  return async (context, next) => {
    if (!loopbackOrigins(port()).includes(`http://${context.req.header("host")}`)) {
      return context.json(failure("bad-host", "This server only answers to its own loopback address."), 403);
    }
    await next();
  };
}

function cacheAs(value: string): MiddlewareHandler {
  return async (context, next) => {
    await next();
    if (context.res.ok) context.res.headers.set("Cache-Control", value);
  };
}

/** What a built Storybook has, so that a directory that isn't one is never served. */
export const isBuiltStorybook = (dir: string): boolean => existsSync(path.join(dir, "iframe.html"));

/**
 * A built Storybook, read only, ready for any Hono caller. It's the code of whatever branch was
 * built, so it must never share an origin with the review API (`docs/specs/access.md`).
 */
export function createStorybookApp({
  dir,
  port,
  readBuildFile,
  reviewOrigins,
}: {
  readonly dir: string;
  readonly port: () => number;
  /** A file of a kept build, or null. */
  readonly readBuildFile: BuildFileReader;
  /** The review pages allowed to show its stories in a frame. */
  readonly reviewOrigins: () => readonly string[];
}): Hono {
  const app = new Hono();
  app.use(storybookHeaders(reviewOrigins));
  app.use(loopbackHosts(port));
  app.route("/", keptBuildRoutes(readBuildFile));
  app.use(cacheAs("no-store"));
  app.use(async (context, next) => {
    if (context.req.method !== "GET" && context.req.method !== "HEAD") return context.text("Only to read.", 405);
    if (!isBuiltStorybook(dir)) return context.text("There's no built Storybook here.", 404);
    return next();
  });
  app.use("*", serveStatic({ root: dir }));
  return app;
}

/** The whole local app, ready for any Hono caller, which lets a test skip the socket. */
export function createLocalApp({
  source,
  port,
  clientDir,
  storybookOrigin,
}: {
  readonly source: ReviewSource;
  readonly port: () => number;
  /** The built client, served for everything that isn't `/api`. */
  readonly clientDir: string;
  /** Where a hosted Storybook is, whose stories the page may show in a frame. */
  readonly storybookOrigin?: string | undefined;
}): Hono {
  const app = new Hono();
  app.use(pageHeaders(storybookOrigin));
  app.use(loopbackHosts(port));
  app.use(sameOriginWrites((context) => `http://${context.req.header("host")}`));
  app.route("/api", createReviewApi(source));
  app.use("/assets/*", cacheAs(IMMUTABLE_ASSET), serveStatic({ root: clientDir }));
  // Vite names an asset by its content, so a missing one is never the page below.
  app.all("/assets/*", (context) => context.notFound());
  // The client routes for itself, so any other page is its one document.
  app.get("*", cacheAs("no-store"), serveStatic({ path: path.join(clientDir, "index.html") }));
  return app;
}

export interface LocalServer {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/** Listens on loopback only. `port` 0 asks the system for a free one. */
export async function serveLocal({
  source,
  port,
  clientDir = CLIENT_DIR,
  storybookOrigin,
}: {
  readonly source: ReviewSource;
  readonly port: number;
  readonly clientDir?: string | undefined;
  readonly storybookOrigin?: string | undefined;
}): Promise<LocalServer> {
  if (!existsSync(path.join(clientDir, "index.html"))) {
    throw Object.assign(new Error("The review UI isn't built yet. Run: pnpm --filter selfie-ui build"), {
      code: "ui-not-built",
    });
  }
  return listen(port, (actual) => createLocalApp({ source, port: actual, clientDir, storybookOrigin }));
}

/** Hosts a built Storybook on a free loopback port, whether or not it has been built yet. */
export function serveStorybook({
  dir,
  readBuildFile,
  reviewOrigins,
}: {
  readonly dir: string;
  readonly readBuildFile: BuildFileReader;
  readonly reviewOrigins: () => readonly string[];
}): Promise<LocalServer> {
  return listen(0, (actual) => createStorybookApp({ dir, port: actual, readBuildFile, reviewOrigins }));
}


async function listen(requested: number, appFor: (port: () => number) => Hono): Promise<LocalServer> {
  let port = requested;
  const app = appFor(() => port);
  const server = await new Promise<ServerType>((resolve, reject) => {
    const listening = serve({ fetch: app.fetch, hostname: LOOPBACK, port: requested }, (info) => {
      port = info.port;
      resolve(listening);
    });
    listening.once("error", reject);
  });
  return {
    url: `http://${LOOPBACK}:${port}/`,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // A browser's idle keep-alive connection would otherwise hold this open.
        (server as Server).closeAllConnections();
      }),
  };
}

/**
 * The review page and the Storybook it frames. Each must name the other's origin, and the review
 * page's source needs the Storybook's address, so the Storybook listens first, and only then learns
 * who may frame it. Nothing can ask it before the review page has an address to ask from.
 */
export async function serveReviewWithStorybook({
  source,
  port,
  clientDir,
  dir,
  readBuildFile,
}: {
  readonly source: (storybookUrl: string) => ReviewSource;
  readonly port: number;
  readonly clientDir?: string | undefined;
  readonly dir: string;
  readonly readBuildFile: BuildFileReader;
}): Promise<{ readonly review: LocalServer; readonly storybook: LocalServer; readonly close: () => Promise<void> }> {
  let reviewOrigins: readonly string[] = [];
  const storybook = await serveStorybook({ dir, readBuildFile, reviewOrigins: () => reviewOrigins });
  try {
    const review = await serveLocal({ source: source(storybook.url), port, clientDir, storybookOrigin: new URL(storybook.url).origin });
    reviewOrigins = loopbackOrigins(review.port);
    return { review, storybook, close: async () => void (await Promise.all([review.close(), storybook.close()])) };
  } catch (error) {
    await storybook.close();
    throw error;
  }
}
