// Verdicts, computed from a comparison's facts, so a caller can recompute them after any decision.
import { filterStories } from "selfie-render";
import { isDecidable, type ComparedRender, type Comparison, type RenderState } from "selfie-store";
import type { AdvisoryReason, Attention, BlockerReason } from "selfie-ui/app";

export { isDecidable };
export type { AdvisoryReason, Attention, BlockerReason };

export interface BatchSummary {
  /** What stops a reviewer calling this batch good. */
  readonly blockers: readonly Attention<BlockerReason>[];
  /** What a reviewer should look at, but which stops nothing. */
  readonly advisories: readonly Attention<AdvisoryReason>[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly added: number;
    /** Those within the batch's filter. */
    readonly removed: number;
    readonly undecided: number;
    readonly advisories: number;
  };
  /** Changed, added, or removed, with no decision. */
  readonly undecided: readonly ComparedRender[];
  /** Changed, added, or removed, and not approved, which includes rejected. */
  readonly unapproved: readonly ComparedRender[];
  readonly failed: readonly ComparedRender[];
  /** Approved stories this batch lacks, which a filter asked for. */
  readonly removed: readonly ComparedRender[];
  /** Approved stories this batch lacks only because its filter left them out. */
  readonly notRendered: readonly ComparedRender[];
}

export function summarizeBatch({ batch, renders, unchangedCount }: Comparison): BatchSummary {
  const inState = (state: RenderState) => renders.filter((render) => render.state === state);
  const failed = inState("failed");

  const allRemoved = inState("removed");
  const asked =
    batch.storyFilter === null
      ? null
      : new Set(
          filterStories(
            allRemoved.map(({ story }) => ({ id: story })),
            batch.storyFilter.patterns,
          ).stories.map(({ id }) => id),
        );
  const removed = asked === null ? allRemoved : allRemoved.filter(({ story }) => asked.has(story));
  const notRendered = asked === null ? [] : allRemoved.filter(({ story }) => !asked.has(story));

  // A story a filter left out says nothing about whether that story is gone, so it takes no decision.
  const outside = new Set(notRendered);
  const unapproved = renders.filter((render) => isDecidable(render.state) && !outside.has(render) && render.decision?.decision !== "approved");
  const undecided = unapproved.filter(({ decision }) => decision === null);

  const blockers: Attention<BlockerReason>[] = [
    ...failed.map(({ story, failure }) => ({ story, reason: "failed" as const, detail: failure })),
    ...unapproved.map(({ story, state, decision }) =>
      decision?.decision === "rejected"
        ? { story, reason: "rejected" as const, detail: decision.actor }
        : state === "removed"
          ? { story, reason: "removed" as const, detail: null }
          : { story, reason: `${state}-unapproved` as "changed-unapproved" | "added-unapproved", detail: null },
    ),
    ...(batch.storyFilter?.unmatched ?? []).map((pattern) => ({
      story: null,
      reason: "pattern-unmatched" as const,
      detail: pattern,
    })),
  ];
  const advisories: Attention<AdvisoryReason>[] = [
    ...renders.flatMap(({ story, playError }) =>
      playError === null ? [] : [{ story, reason: "play-error" as const, detail: playError }],
    ),
  ];

  const changed = inState("changed").length;
  const added = inState("added").length;
  return {
    blockers,
    advisories,
    counts: {
      stories: unchangedCount + changed + added + failed.length,
      unchanged: unchangedCount,
      changed,
      added,
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
