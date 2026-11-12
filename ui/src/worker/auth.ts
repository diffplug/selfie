// Who's asking. This service has one writer, who signs in through GitHub (`login.ts`) or syncs with a
// bearer token, and everything it hosts is public. See docs/specs/access.md -> Who can do what.

import { timingSafeEqual } from "hono/utils/buffer";

/** What the writer's decisions record as their decider. */
export const WRITER = "nedtwigg";
/** The writer's GitHub account, by the numeric ID that a rename keeps and nobody else can reuse. */
export const WRITER_GITHUB_ID = "2924992";

/** Compares digests, so how long this takes says nothing about how much of a guess was right. */
export const sameSecret = (given: string, secret: string): Promise<boolean> => timingSafeEqual(given, secret);
