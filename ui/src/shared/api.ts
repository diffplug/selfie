// What crosses between the browser and the server, and what the server needs from its platform.
// Types only, so the client's bundle holds none of the server, and the server none of the client.
import type { ComparedSnapshot, DecisionKind, Run } from "selfie-store";

export type { ComparedSnapshot, DecisionKind, Run, SnapshotState } from "selfie-store";

export type PixelDiff =
  | {
      readonly kind: "pixels";
      readonly changedPixels: number;
      readonly totalPixels: number;
      readonly boundingBox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      } | null;
      readonly firstChanged: { readonly x: number; readonly y: number } | null;
      readonly maxChannelDelta: number;
    }
  | {
      readonly kind: "size-differs";
      readonly current: { readonly width: number; readonly height: number };
      readonly golden: { readonly width: number; readonly height: number };
    };

export type BlockerReason =
  | "failed"
  | "changed-unapproved"
  | "new-unapproved"
  | "rejected"
  | "removed"
  | "pattern-unmatched";

export type AdvisoryReason = "play-error" | "unstable";

export interface Attention<Reason extends string> {
  readonly story: string | null;
  readonly reason: Reason;
  readonly detail: string | null;
}

export type AcceptRefusal =
  | { readonly reason: "recorded-on-dirty-tree"; readonly gitSha: string }
  | { readonly reason: "run-has-failures"; readonly stories: readonly string[] }
  | {
      readonly reason: "unapproved";
      readonly stories: readonly {
        readonly story: string;
        readonly state: string;
        readonly decision: DecisionKind | null;
      }[];
    }
  | {
      readonly reason: "removed-unacknowledged";
      readonly stories: readonly string[];
      readonly outsideFilter: number;
    }
  | {
      readonly reason: "wrong-removed-count";
      readonly stories: readonly string[];
      readonly outsideFilter: number;
      readonly seen: number;
    };

/** A compared snapshot, with the pixel stats its review exported, if they're still on disk. */
export interface SnapshotRow extends ComparedSnapshot {
  readonly pixelDiff: PixelDiff | null;
}

/** Why a run or a repository has no baseline, if that's so. */
export interface BaselineNote {
  readonly sha: string | null;
  readonly reason: string | null;
  readonly message: string | null;
}

export interface RunListing {
  readonly id: string;
  readonly startedAt: number;
  readonly status: Run["status"];
  readonly dirty: boolean;
}

/** Everything a screen shows about a run, recomputed from `summarizeRun` after every action. */
export interface RunView {
  readonly run: Run;
  readonly baseline: BaselineNote;
  /** The run whose images are the goldens of this run's Git SHA, which may be this one. */
  readonly acceptedRunId: string | null;
  /** Who a decision made here is recorded as, or null if Git doesn't say. */
  readonly actor: string | null;
  readonly blockers: readonly Attention<BlockerReason>[];
  readonly advisories: readonly Attention<AdvisoryReason>[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly new: number;
    readonly removed: number;
    readonly failed: number;
    readonly undecided: number;
    readonly advisories: number;
  };
  /** Everything that isn't unchanged, and anything with an advisory, in name order. */
  readonly rows: readonly SnapshotRow[];
  /** Goldens this run lacks only because its filter left them out, and not listed in `rows`. */
  readonly notRendered: readonly string[];
  /** What `accept` would refuse now, were no removals acknowledged. */
  readonly refusals: readonly AcceptRefusal[];
  /** Every golden accepting would drop. Acknowledging means passing this list's length. */
  readonly removals: readonly string[];
  readonly usableAsBaseline: boolean;
  /** Every run at this SHA and environment, newest first, this one included. */
  readonly siblings: readonly RunListing[];
}

/** Which run the UI opens to: the newest finished one at HEAD, in the project's environment. */
export interface CurrentView {
  readonly head: string | null;
  readonly environment: string;
  readonly runId: string | null;
  readonly runs: readonly RunListing[];
  readonly baseline: BaselineNote;
}

export interface AcceptOutcome {
  readonly accepted: boolean;
  /** Empty if accepted. These include any about the count this request passed. */
  readonly refusals: readonly AcceptRefusal[];
  readonly view: RunView;
}

export interface DiffView {
  readonly diff: PixelDiff;
  /** A size difference has no diff image. */
  readonly hasImage: boolean;
}

export interface ApiError {
  readonly error: { readonly code: string; readonly message: string };
}

export interface DecisionTarget {
  readonly story: string;
  readonly imageHash: string;
}

/**
 * The seam between the routes and a platform: how they reach a project's data. `cli/src/ui.ts`
 * implements it for a local repository, and a Worker would implement it for D1 and R2. An error
 * with a `code` from `ERROR_STATUS` becomes that status with its message.
 */
export interface ReviewSource {
  current(): Promise<CurrentView>;
  runView(runId: string): Promise<RunView>;
  unchanged(runId: string): Promise<readonly SnapshotRow[]>;
  /** Decides on exactly these images, or refuses all of them if one isn't what the run holds. */
  decide(runId: string, decision: DecisionKind, targets: readonly DecisionTarget[]): Promise<RunView>;
  accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome>;
  /** The stored bytes, or null if this store doesn't hold it. */
  image(hash: string): Promise<Uint8Array | null>;
  /** Null if the store doesn't hold both. */
  diff(current: string, golden: string): Promise<{ diff: PixelDiff; png: Uint8Array | null } | null>;
}

/** The custom header every state-changing request needs, since a form on another site can't send one. */
export const REQUEST_HEADER = "x-selfie-request";
export const REQUEST_HEADER_VALUE = "review-ui";
