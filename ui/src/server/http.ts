// What every API here answers the same way.
import type { Context, MiddlewareHandler } from "hono";
import { imageMediaType } from "selfie-store";
import type { ApiError } from "../shared/api.ts";

export const CONTENT_ADDRESSED = "private, max-age=31536000, immutable";

export const failure = (code: string, message: string): ApiError => ({ error: { code, message } });

export const INTERNAL_ERROR = failure("internal", "Something went wrong in the Selfie server. Its log says what.");

/** Crockford's base 32, which has no I, L, O, or U to misread or mishear. */
const ERROR_ID_DIGITS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A new code for one error, which what a person sees and the log both carry, so one finds the other. */
export function errorId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => ERROR_ID_DIGITS[byte % 32]).join("");
}

/** Says what went wrong under its code, with the error behind it if there is one. */
export function logError(id: string, what: string, cause?: unknown): void {
  const causes: unknown[] = [];
  for (let at = cause; at !== undefined && causes.length < 4; at = at instanceof Error ? at.cause : undefined) causes.push(at);
  console.error(`Error ${id}: ${what}`, ...causes);
}

/**
 * Gives every error answer a code, and logs it under that code: a JSON error gets `error.id`, and a
 * plain text one a last line saying it. An error some handler caught is logged with it.
 */
export const errorCodes: MiddlewareHandler = async (context, next) => {
  await next();
  const response = context.res;
  if (response.status < 400) return;
  const type = response.headers.get("content-type") ?? "";
  const json = type.startsWith("application/json");
  if (!json && !type.startsWith("text/plain")) return;
  const text = await response.clone().text();
  let body: Partial<ApiError> | null = null;
  if (json) {
    try {
      body = JSON.parse(text) as Partial<ApiError>;
    } catch {
      return;
    }
    if (typeof body?.error !== "object" || body.error === null || "id" in body.error) return;
  }
  const id = errorId();
  const { pathname } = new URL(context.req.url);
  const said = body === null ? text : `${body.error!.code}: ${body.error!.message}`;
  logError(id, `${response.status} for ${context.req.method} ${pathname}, ${said}`, response.status >= 500 ? context.error : undefined);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const answer = body === null ? `${text}\nError code: ${id}` : JSON.stringify({ error: { ...body.error, id } });
  context.res = undefined;
  context.res = new Response(answer, { status: response.status, statusText: response.statusText, headers });
};

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
