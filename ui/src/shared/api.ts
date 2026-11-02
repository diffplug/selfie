// What crosses between the browser and the server, and what the server needs from its platform.
// Types only, so the client's bundle holds none of the server, and the server none of the client.
// `selfie-cli` takes its own result types from here, so each has one definition.
import type { ComparedSnapshot, DecisionKind, Run } from "selfie-store";

export type { ComparedSnapshot, DecisionKind, Run, SnapshotState } from "selfie-store";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PixelDiff =
  | {
      readonly kind: "pixels";
      readonly changedPixels: number;
      readonly totalPixels: number;
      /** Null only if the images are identical, which a `changed` snapshot never is. */
      readonly boundingBox: BoundingBox | null;
      /** The first changed pixel in reading order, which `boundingBox`'s center need not be. */
      readonly firstChanged: { readonly x: number; readonly y: number } | null;
      /** The largest difference in any one channel of any pixel, 1 to 255. */
      readonly maxChannelDelta: number;
    }
  | {
      /** Nothing lines up, so there are no pixels to compare and no diff image. */
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

export type AdvisoryReason = "play-error";

export interface Attention<Reason extends string> {
  /** Null only for `pattern-unmatched`. */
  readonly story: string | null;
  readonly reason: Reason;
  /** The fact behind it, if there's more than its name: a message, an actor, or a pattern. */
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
      /** How many of `stories` are gone only because the run's filter left them out. */
      readonly outsideFilter: number;
    }
  | {
      readonly reason: "wrong-removed-count";
      readonly stories: readonly string[];
      readonly outsideFilter: number;
      /** The count the caller gave. */
      readonly seen: number;
    };

/** A compared snapshot, with the pixel stats its review exported, if they're still on disk. */
export interface SnapshotRow extends ComparedSnapshot {
  readonly pixelDiff: PixelDiff | null;
}

/** The baseline a review would use, and why there's none, if that's so. */
export interface BaselineNote {
  readonly sha: string | null;
  readonly message: string | null;
}

export type RunListing = Pick<Run, "id" | "startedAt" | "status" | "dirty">;

/** Everything a screen shows about a run, recomputed from `summarizeRun` after every action. */
export interface RunView {
  readonly run: Run;
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
  /** What `accept` would refuse now, were no removals acknowledged. */
  readonly refusals: readonly AcceptRefusal[];
  /**
   * Every golden accepting would drop, and how many only the run's filter left out, which aren't in
   * `rows`. Acknowledging means passing the length of `stories`.
   */
  readonly removals: { readonly stories: readonly string[]; readonly outsideFilter: number };
  readonly usableAsBaseline: boolean;
  /** Every run at this SHA and environment, newest first, this one included. */
  readonly siblings: readonly RunListing[];
}

/** Which run the UI opens to: the newest finished one at HEAD, in the project's environment. */
export interface CurrentView {
  readonly head: string | null;
  readonly runId: string | null;
  /** HEAD has runs, and none finished. */
  readonly hasUnfinishedRun: boolean;
  /** Only asked for if there's no run to open. */
  readonly baseline: BaselineNote | null;
}

export interface AcceptOutcome {
  readonly accepted: boolean;
  /** Empty if accepted. These include any about the count this request passed. */
  readonly refusals: readonly AcceptRefusal[];
  readonly view: RunView;
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
 * implements it for a local repository. An error with a `code` from `ERROR_STATUS` becomes that
 * status with its message.
 */
export interface ReviewSource {
  current(): Promise<CurrentView>;
  runView(runId: string): Promise<RunView>;
  /** Why the run has no baseline: only a screen showing that asks. */
  baseline(runId: string): Promise<BaselineNote>;
  unchanged(runId: string): Promise<readonly SnapshotRow[]>;
  /** Decides on exactly these images, or refuses all of them if one isn't what the run holds. */
  decide(runId: string, decision: DecisionKind, targets: readonly DecisionTarget[]): Promise<RunView>;
  accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome>;
  /** The stored bytes, or null if this store doesn't hold it. */
  image(hash: string): Promise<Uint8Array | null>;
  /** Null if the store doesn't hold both. A size difference has no `png`. */
  diff(current: string, golden: string): Promise<{ diff: PixelDiff; png: Uint8Array | null } | null>;
}

/** The custom header every state-changing request needs, since a form on another site can't send one. */
export const REQUEST_HEADER = "x-selfie-request";
export const REQUEST_HEADER_VALUE = "review-ui";
