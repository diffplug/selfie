// Verdicts, computed from a comparison's facts, so a caller can recompute them after any decision.
import { isDecidable, type ComparedRender, type Comparison, type RenderState } from "./render-batches.ts";
import { filterStories } from "./stories.ts";

export type BlockerReason =
  | "failed"
  | "changed-unapproved"
  | "added-unapproved"
  | "rejected"
  | "removed"
  | "pattern-unmatched";

export interface Attention {
  /** Null only for `pattern-unmatched`. */
  readonly story: string | null;
  readonly reason: BlockerReason;
  /** The fact behind it, if there's more than its name: a message, an actor, or a pattern. */
  readonly detail: string | null;
}

export interface BatchSummary {
  /** What stops a reviewer calling this batch good. */
  readonly blockers: readonly Attention[];
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly added: number;
    /** Those within the batch's filter. */
    readonly removed: number;
    readonly undecided: number;
  };
  /** Every render, but for what's in `notRendered`. */
  readonly inFilter: readonly ComparedRender[];
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

/** A decision on exactly these images, as a person saw them. */
export interface ExactTarget {
  readonly story: string;
  /** Null for a story that's gone. */
  readonly imageHash: string | null;
}

/** The rows these targets name, and how many of them aren't what a batch holds now, in which case none should be decided. */
export function exactRows(renders: readonly ComparedRender[], targets: readonly ExactTarget[]): { readonly rows: readonly ComparedRender[]; readonly stale: number } {
  const rows = new Map(renders.filter(({ state }) => isDecidable(state)).map((row) => [row.story, row]));
  const stale = targets.filter(({ story, imageHash }) => rows.get(story)?.imageHash !== imageHash).length;
  return { rows: stale > 0 ? [] : targets.map(({ story }) => rows.get(story)!), stale };
}

export const staleDecisionMessage = (stale: number) => `${stale} of these images aren't what this batch holds now, so nothing was decided. Look again.`;

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
  const inFilter = renders.filter((render) => !outside.has(render));
  const unapproved = inFilter.filter(({ state, decision }) => isDecidable(state) && decision?.decision !== "approved");
  const undecided = unapproved.filter(({ decision }) => decision === null);

  const blockers: Attention[] = [
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

  const changed = inState("changed").length;
  const added = inState("added").length;
  return {
    blockers,
    counts: {
      stories: unchangedCount + changed + added + failed.length,
      unchanged: unchangedCount,
      changed,
      added,
      removed: removed.length,
      undecided: undecided.length,
    },
    inFilter,
    undecided,
    unapproved,
    failed,
    removed,
    notRendered,
  };
}
