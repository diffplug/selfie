// What every API here answers the same way.
import type { Context, MiddlewareHandler } from "hono";
import { imageMediaType } from "selfie-store";
import type { ApiError } from "../shared/api.ts";

export const CONTENT_ADDRESSED = "private, max-age=31536000, immutable";

export const failure = (code: string, message: string): ApiError => ({ error: { code, message } });

export const INTERNAL_ERROR = failure("internal", "Something went wrong in the Selfie server. Its log says what.");

export function imageResponse(context: Context, bytes: Uint8Array) {
  return context.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": imageMediaType(bytes),
    "Cache-Control": CONTENT_ADDRESSED,
  });
}

/** Nothing an API says is cached, unless it says so itself. */
export const noStoreByDefault: MiddlewareHandler = async (context, next) => {
  await next();
  if (!context.res.headers.has("Cache-Control")) context.res.headers.set("Cache-Control", "no-store");
};
