// What crosses between a store's client and the sync routes. Types only, so the CLI can use them
// without loading the server. See docs/specs/sync.md.
import type { Decision, RecordedRender, RenderBatch, BatchPage } from "selfie-store";

export type { BatchPage };

export interface ProjectAccess {
  readonly view: boolean;
  readonly upload: boolean;
  readonly decide: boolean;
}

/** A batch's facts, as a sender states them. */
export type SentBatch = Omit<RenderBatch, "id" | "status" | "finishedAt" | "failedCount">;

export type SentRender = RecordedRender;

/** A decision as a sender states it, which the server says who it's by. */
export interface SentDecision extends Omit<Decision, "actor"> {
  readonly story: string;
  readonly imageHash: string;
}

export type GoldensOutcome = "accepted" | "already" | "conflict" | "refused";

export interface GoldensAnswer {
  readonly outcome: GoldensOutcome;
  /** The batch that's now the commit's goldens, if any. */
  readonly acceptedBatchId: string | null;
  readonly refusal: { readonly code: string; readonly message: string } | null;
}

export interface SyncError {
  readonly error: { readonly code: string; readonly message: string };
}

/** The most of each a request may hold. */
export const SYNC_LIMITS = { hashes: 500, renders: 1_000, decisions: 1_000, shas: 1_000 } as const;
