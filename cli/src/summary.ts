// Verdicts, computed from a comparison's facts, so a caller can recompute them after any decision.
import { filterStories } from "selfie-render";
import type { ComparedSnapshot, Comparison, SnapshotState } from "selfie-store";

export type BlockerReason =
  | "failed"
  | "changed-unapproved"
  | "new-unapproved"
  | "rejected"
  | "removed"
  | "pattern-unmatched";

export type AdvisoryReason = "play-error" | "unstable";

export interface Attention<Reason extends string> {
  /** Null only for `pattern-unmatched`. */
  readonly story: string | null;
  readonly reason: Reason;
  /** The fact behind it, if there's more than its name: a message, an actor, or a pattern. */
  readonly detail: string | null;
}

export interface RunSummary {
  /** What stops a reviewer calling this run good. */
  readonly blockers: readonly Attention<BlockerReason>[];
  /** What a reviewer should look at, but which stops nothing. */
  readonly advisories: readonly Attention<AdvisoryReason>[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly new: number;
    /** Those within the run's filter. */
    readonly removed: number;
    readonly undecided: number;
    readonly advisories: number;
  };
  /** Changed or new, with no decision. */
  readonly undecided: readonly ComparedSnapshot[];
  /** Changed or new, and not approved, which includes rejected. */
  readonly unapproved: readonly ComparedSnapshot[];
  readonly failed: readonly ComparedSnapshot[];
  /** Goldens this run lacks, which a filter asked for. */
  readonly removed: readonly ComparedSnapshot[];
  /** Goldens this run lacks only because its filter left them out. */
  readonly notRendered: readonly ComparedSnapshot[];
}

/** Whether a snapshot in this state has an image that can take a decision. */
export const isDecidable = (state: SnapshotState) => state === "changed" || state === "new";

export function summarizeRun({ run, snapshots, unchangedCount }: Comparison): RunSummary {
  const inState = (state: SnapshotState) => snapshots.filter((snapshot) => snapshot.state === state);
  const failed = inState("failed");
  const unapproved = snapshots.filter(
    ({ state, decision }) => isDecidable(state) && decision?.decision !== "approved",
  );
  const undecided = unapproved.filter(({ decision }) => decision === null);

  const allRemoved = inState("removed");
  const asked =
    run.storyFilter === null
      ? null
      : new Set(
          filterStories(
            allRemoved.map(({ story }) => ({ id: story })),
            run.storyFilter.patterns,
          ).stories.map(({ id }) => id),
        );
  const removed = asked === null ? allRemoved : allRemoved.filter(({ story }) => asked.has(story));
  const notRendered = asked === null ? [] : allRemoved.filter(({ story }) => !asked.has(story));

  const blockers: Attention<BlockerReason>[] = [
    ...failed.map(({ story, failure }) => ({ story, reason: "failed" as const, detail: failure })),
    ...unapproved.map(({ story, state, decision }) =>
      decision?.decision === "rejected"
        ? { story, reason: "rejected" as const, detail: decision.actor }
        : { story, reason: `${state}-unapproved` as "changed-unapproved" | "new-unapproved", detail: null },
    ),
    ...removed.map(({ story }) => ({ story, reason: "removed" as const, detail: null })),
    ...(run.storyFilter?.unmatched ?? []).map((pattern) => ({
      story: null,
      reason: "pattern-unmatched" as const,
      detail: pattern,
    })),
  ];
  const advisories: Attention<AdvisoryReason>[] = [
    ...snapshots.flatMap(({ story, playError }) =>
      playError === null ? [] : [{ story, reason: "play-error" as const, detail: playError }],
    ),
    ...snapshots.flatMap(({ story, unstable }) =>
      unstable === true ? [{ story, reason: "unstable" as const, detail: null }] : [],
    ),
  ];

  const changed = inState("changed").length;
  const added = inState("new").length;
  return {
    blockers,
    advisories,
    counts: {
      stories: unchangedCount + changed + added + failed.length,
      unchanged: unchangedCount,
      changed,
      new: added,
      removed: removed.length,
      undecided: undecided.length,
      advisories: advisories.length,
    },
    undecided,
    unapproved,
    failed,
    removed,
    notRendered,
  };
}
