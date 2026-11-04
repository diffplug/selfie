// Who's asking. This service has one writer, known by a password, and everything it hosts is public, so
// there are no accounts. See docs/specs/access.md -> Who can do what.

import { timingSafeEqual } from "hono/utils/buffer";
import { parse } from "hono/utils/cookie";
import { toHex } from "selfie-store";

export const WRITER = "nedtwigg";
const COOKIE = "__Host-selfie-session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Compares digests, so how long this takes says nothing about how much of a guess was right. */
export const sameSecret = (given: string, secret: string): Promise<boolean> => timingSafeEqual(given, secret);

/** Signed with the password, so changing it signs everyone out. */
async function signature(until: number, password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`selfie-session:${until}`))));
}

/** `__Host-` so nothing on another subdomain can set it, and `Strict` so no other site's page sends it. */
export async function sessionCookie(password: string, now: number): Promise<string> {
  const until = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${COOKIE}=${until}.${await signature(until, password)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}


/** The writer, if this request's cookie says so, or else nobody. */
export async function actorFromCookie(header: string | undefined, password: string, now: number): Promise<string | null> {
  const [untilText, given] = (header === undefined ? undefined : parse(header, COOKIE)[COOKIE])?.split(".") ?? [];
  const until = Number(untilText);
  if (given === undefined || !Number.isSafeInteger(until) || until * 1000 <= now) return null;
  return (await sameSecret(given, await signature(until, password))) ? WRITER : null;
}
