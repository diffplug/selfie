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
  /** Changed or new, with no decision. */
  readonly undecided: readonly ComparedRender[];
  /** Changed or new, and not approved, which includes rejected. */
  readonly unapproved: readonly ComparedRender[];
  readonly failed: readonly ComparedRender[];
  /** Goldens this batch lacks, which a filter asked for. */
  readonly removed: readonly ComparedRender[];
  /** Goldens this batch lacks only because its filter left them out. */
  readonly notRendered: readonly ComparedRender[];
}

export function summarizeBatch({ batch, renders, unchangedCount }: Comparison): BatchSummary {
  const inState = (state: RenderState) => renders.filter((render) => render.state === state);
  const failed = inState("failed");
  const unapproved = renders.filter(
    ({ state, decision }) => isDecidable(state) && decision?.decision !== "approved",
  );
  const undecided = unapproved.filter(({ decision }) => decision === null);

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

  const blockers: Attention<BlockerReason>[] = [
    ...failed.map(({ story, failure }) => ({ story, reason: "failed" as const, detail: failure })),
    ...unapproved.map(({ story, state, decision }) =>
      decision?.decision === "rejected"
        ? { story, reason: "rejected" as const, detail: decision.actor }
        : { story, reason: `${state}-unapproved` as "changed-unapproved" | "added-unapproved", detail: null },
    ),
    ...removed.map(({ story }) => ({ story, reason: "removed" as const, detail: null })),
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
      added: added,
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
