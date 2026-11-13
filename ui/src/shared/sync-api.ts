// What crosses between a store's client and the sync routes. Types only, so the CLI can use them
// without loading the server. See docs/specs/sync.md.
import type { PlacedDecision, RenderBatch } from "selfie-store";

export interface ProjectAccess {
  readonly view: boolean;
  readonly upload: boolean;
  readonly decide: boolean;
}

/**
 * A batch's facts, as a sender states them. `branchBegan` is when its branch began its own work, in milliseconds,
 * which a sender with Git says for a batch on a branch other than the default, and a server without Git can't work out.
 */
export type SentBatch = Omit<RenderBatch, "id" | "status" | "finishedAt" | "failedCount"> & { readonly branchBegan?: number };

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
