// What crosses between a store's client and the sync routes. Types only, so the CLI can use them
// without loading the server. See docs/specs/sync.md.
import type { PlacedDecision, RecordedRender, RenderBatch } from "selfie-store";

export interface ProjectAccess {
  readonly view: boolean;
  readonly upload: boolean;
  readonly decide: boolean;
}

/** A batch's facts, as a sender states them. */
export type SentBatch = Omit<RenderBatch, "id" | "status" | "finishedAt" | "failedCount">;

/** A decision as a sender states it, which the server says who it's by. */
export type SentDecision = Omit<PlacedDecision, "actor">;

export interface SyncError {
  /** `id` is this one error's code, which the server logged it under. */
  readonly error: { readonly code: string; readonly message: string; readonly id?: string };
}

/** The most of each a request may hold. */
export const SYNC_LIMITS = { hashes: 500, renders: 1_000, decisions: 1_000, shas: 1_000, commits: 1_000 } as const;

/** Two images a server can't compare for itself, whose difference it wants. */
export interface DiffPair {
  readonly current: string;
  readonly golden: string;
}

/**
 * What a store asks for to find a commit's base, which the remote may not have, by the commits its history
 * reaches, as for decisions (`docs/specs/renders.md` -> Approved since a base).
 */
export interface BaseRequest {
  readonly environment: string;
  /** The default branch, as a batch names the branch it was on. */
  readonly branch: string;
  /** The commit whose base it is, which is never its own. */
  readonly gitSha: string;
  /** Its history, at most `SYNC_LIMITS.shas`. */
  readonly commits: readonly string[];
}

export interface BaseAnswer {
  /** The finished batch, or null if those commits reach none. */
  readonly batch: RenderBatch | null;
}

/** A page of a finished batch's renders, and where the next starts, or null after the last. */
export interface RendersPage {
  readonly renders: readonly RecordedRender[];
  readonly next: string | null;
}
