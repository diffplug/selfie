// A hosted Storybook's headers and kept builds, which any platform can serve. Which host may ask,
// and the directory as it stands, are `local.ts`'s. See docs/specs/ui.md -> Routes.
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
import { tryDecodeURIComponent } from "hono/utils/url";
import { keptBuildPath } from "../shared/api.ts";
import { CONTENT_ADDRESSED } from "./http.ts";

/**
 * Storybook loads its own preview in a frame and runs inline scripts, so the review page's headers
 * are too strict for it. Its own origin is what keeps it from the review API.
 */
export const storybookHeaders = secureHeaders({
  contentSecurityPolicy: { frameAncestors: ["'self'"] },
  crossOriginResourcePolicy: "same-origin",
  referrerPolicy: "no-referrer",
  xFrameOptions: "SAMEORIGIN",
  strictTransportSecurity: false,
});

export type BuildFileReader = (build: string, file: string) => Promise<Uint8Array | null>;

/** Every kept build's files, which never change, so a browser may hold on to them. */
export function keptBuildRoutes(readBuildFile: BuildFileReader): Hono {
  const app = new Hono();
  app.get(`${keptBuildPath(":build")}*`, async (context) => {
    const build = context.req.param("build")!;
    const file = tryDecodeURIComponent(context.req.path.slice(keptBuildPath(build).length)) || "index.html";
    const bytes = await readBuildFile(build, file);
    if (bytes === null) return context.text("That isn't a file of a kept build.", 404);
    return context.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": getMimeType(file) ?? "application/octet-stream",
      "Cache-Control": CONTENT_ADDRESSED,
    });
  });
  return app;
}
