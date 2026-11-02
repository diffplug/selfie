// The local half of the seam: who may talk to a server on this machine, and how Node serves it.
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { REQUEST_HEADER, REQUEST_HEADER_VALUE, type ApiError, type ReviewSource } from "../shared/api.ts";
import { createReviewApi } from "./app.ts";

const LOOPBACK = "127.0.0.1";
const IMMUTABLE_ASSET = "public, max-age=31536000, immutable";

/** Where `vite build` puts the client. */
export const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

const hasClientIn = (clientDir: string) => existsSync(path.join(clientDir, "index.html"));

const refused = (code: string, message: string): ApiError => ({ error: { code, message } });

/**
 * Refuses a request not addressed to this server by a loopback name, so a site that points its own
 * DNS name at 127.0.0.1 can't read anything, and refuses every state change a page on another
 * site could cause. `port` is asked per request, since listening decides it.
 */
export function localGuard(port: () => number): MiddlewareHandler {
  return async (context, next) => {
    const allowedHosts = [`${LOOPBACK}:${port()}`, `localhost:${port()}`];
    const host = context.req.header("host");
    if (host === undefined || !allowedHosts.includes(host)) {
      return context.json(refused("bad-host", "This server only answers to its own loopback address."), 403);
    }
    const origin = context.req.header("origin");
    if (origin !== undefined && origin !== `http://${host}`) {
      return context.json(refused("bad-origin", "This server doesn't answer other sites."), 403);
    }
    if (context.req.method !== "GET" && context.req.method !== "HEAD") {
      // A form can't send this header or this type, and a page's fetch can't without a preflight,
      // which gets no CORS headers from here.
      const contentType = context.req.header("content-type")?.split(";")[0]?.trim();
      if (context.req.header(REQUEST_HEADER) !== REQUEST_HEADER_VALUE || contentType !== "application/json") {
        return context.json(refused("bad-request-kind", "A change must come from the review page."), 403);
      }
    }
    await next();
    const { headers } = context.res;
    // Another site can't frame the page to steer a click, or embed an image to learn it exists.
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
  };
}

function cacheAs(value: string): MiddlewareHandler {
  return async (context, next) => {
    await next();
    if (context.res.ok) context.res.headers.set("Cache-Control", value);
  };
}

export interface LocalAppOptions {
  readonly source: ReviewSource;
  readonly port: () => number;
  /** The built client, served for everything that isn't `/api`. */
  readonly clientDir: string;
}

/** The whole local app, ready for any Hono caller, which lets a test skip the socket. */
export function createLocalApp({ source, port, clientDir }: LocalAppOptions): Hono {
  const app = new Hono();
  app.use(localGuard(port));
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
  if (!hasClientIn(clientDir)) {
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
