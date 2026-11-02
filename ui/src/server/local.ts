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

const LOOPBACK = "127.0.0.1";
const IMMUTABLE_ASSET = "public, max-age=31536000, immutable";

/** Where `vite build` puts the client. */
const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

/**
 * Refuses a request not addressed to this server by a loopback name, so a site that points its own
 * DNS name at 127.0.0.1 can't read anything. `port` is asked per request, since listening decides it.
 */
function loopbackHosts(port: () => number): MiddlewareHandler {
  return async (context, next) => {
    const host = context.req.header("host");
    if (host !== `${LOOPBACK}:${port()}` && host !== `localhost:${port()}`) {
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

/** The whole local app, ready for any Hono caller, which lets a test skip the socket. */
export function createLocalApp({
  source,
  port,
  clientDir,
}: {
  readonly source: ReviewSource;
  readonly port: () => number;
  /** The built client, served for everything that isn't `/api`. */
  readonly clientDir: string;
}): Hono {
  const app = new Hono();
  app.use(pageHeaders);
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
  port: requested,
  clientDir = CLIENT_DIR,
}: {
  readonly source: ReviewSource;
  readonly port: number;
  readonly clientDir?: string;
}): Promise<LocalServer> {
  if (!existsSync(path.join(clientDir, "index.html"))) {
    throw Object.assign(new Error("The review UI isn't built yet. Run: pnpm --filter selfie-ui build"), {
      code: "ui-not-built",
    });
  }
  let port = requested;
  const app = createLocalApp({ source, port: () => port, clientDir });
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
