// A hosted Storybook's headers and kept built Storybooks, which any platform can serve. Which host may ask,
// and the directory as it stands, are `local.ts`'s. See docs/specs/ui.md -> Routes.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
import { tryDecodeURIComponent } from "hono/utils/url";
import { keptStorybookPath } from "../shared/api.ts";
import { CONTENT_ADDRESSED } from "./http.ts";

/**
 * Storybook loads its own preview in a frame and runs inline scripts, so the review page's headers
 * are too strict for it. Its own origin is what keeps it from the review API. Only it and the review
 * page may frame it, which `X-Frame-Options` has no way to say, so that's left to the CSP.
 */
export const storybookHeaders = (reviewOrigins: () => readonly string[]): MiddlewareHandler =>
  secureHeaders({
    contentSecurityPolicy: { frameAncestors: ["'self'", () => reviewOrigins().join(" ")] },
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "no-referrer",
    xFrameOptions: false,
    strictTransportSecurity: false,
  });

/** A kept built Storybook's file, gzipped, as `BuiltStorybooks.readGzippedFile` gives it. */
export type StorybookFileReader = (build: string, file: string, context: Context) => Promise<Uint8Array | null>;

/** Every kept built Storybook's files, which never change, so a browser may hold on to them. Sent gzipped, as they're kept. */
export function keptStorybookRoutes(readStorybookFile: StorybookFileReader): Hono {
  const app = new Hono();
  app.get(`${keptStorybookPath(":build")}*`, async (context) => {
    const build = context.req.param("build")!;
    // After its own prefix, whatever a platform mounts these under.
    const kept = keptStorybookPath(build);
    const file = tryDecodeURIComponent(context.req.path.slice(context.req.path.indexOf(kept) + kept.length)) || "index.html";
    const bytes = await readStorybookFile(build, file, context);
    if (bytes === null) return context.text("That isn't a file of a kept built Storybook.", 404);
    // Whatever the request accepts, since every browser takes gzip. `encodeBody` has a Worker send the bytes as they are.
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      encodeBody: "manual",
      headers: { "Content-Type": getMimeType(file) ?? "application/octet-stream", "Content-Encoding": "gzip", "Cache-Control": CONTENT_ADDRESSED },
    } as ResponseInit);
  });
  return app;
}
