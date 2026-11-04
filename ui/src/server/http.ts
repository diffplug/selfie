// What every API here answers the same way.
import type { Context, MiddlewareHandler } from "hono";
import { imageMediaType } from "selfie-store";
import type { ApiError } from "../shared/api.ts";

export const CONTENT_ADDRESSED = "private, max-age=31536000, immutable";

export const failure = (code: string, message: string): ApiError => ({ error: { code, message } });

export const INTERNAL_ERROR = failure("internal", "Something went wrong in the Selfie server. Its log says what.");

/** `nosniff` since a cloud store takes a file's body unread, so only this type says what it is. */
export function imageResponse(context: Context, bytes: Uint8Array) {
  return context.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": imageMediaType(bytes),
    "Cache-Control": CONTENT_ADDRESSED,
    "X-Content-Type-Options": "nosniff",
  });
}

/** Nothing an API says is cached, unless it says so itself. */
export const noStoreByDefault: MiddlewareHandler = async (context, next) => {
  await next();
  if (!context.res.headers.has("Cache-Control")) context.res.headers.set("Cache-Control", "no-store");
};

/** After answering where the platform can do that, so nobody waits on it, and otherwise before. */
export async function afterResponse(context: Context, work: Promise<void>): Promise<void> {
  let executionContext: Context["executionCtx"];
  try {
    executionContext = context.executionCtx;
  } catch {
    await work;
    return;
  }
  executionContext.waitUntil(work);
}
