// Deciding on a batch, from what the store knows about it, whether or not its exported images are
// still on disk.
import { filterStories } from "selfie-render";
import { exactRows, isDecidable, staleDecisionMessage, summarizeBatch, type ComparedRender, type Comparison, type DecisionKind } from "selfie-store";
import type { DecisionTarget } from "selfie-ui/app";
import { SelfieError } from "./errors.ts";
import { compareAsReviewed, type Project } from "./project.ts";

export interface DecideRequest {
  readonly batchId: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  /**
   * Everything changed, added, or removed, those whose story IDs match these patterns, or exactly these
   * images, for a caller that showed them, which refuses all of them if any is out of date.
   */
  readonly stories: "all" | readonly string[] | { readonly targets: readonly DecisionTarget[] };
}

export interface DecideResult {
  /** The renders that took the decision. */
  readonly decided: readonly ComparedRender[];
  /** What was selected, but can't take one, since it failed to render. */
  readonly skipped: readonly ComparedRender[];
  /** Patterns that matched nothing, which a caller shouldn't read as a decision made. */
  readonly unmatchedPatterns: readonly string[];
  /** The batch as it stands after this decision. */
  readonly comparison: Comparison;
}

/** Exactly these rows, each still holding the image named, or nothing is decided. */
function exactly(renders: readonly ComparedRender[], targets: readonly DecisionTarget[]): readonly ComparedRender[] {
  const { rows, stale } = exactRows(renders, targets);
  if (stale > 0) throw new SelfieError("stale-decision", staleDecisionMessage(stale));
  return rows;
}

export async function decide(project: Project, { batchId, decision, actor, stories }: DecideRequest): Promise<DecideResult> {
  const patterns = stories === "all" || "targets" in stories ? null : stories;
  // Unchanged rows only say whether a pattern matched anything.
  const before = await compareAsReviewed(project, batchId, { includeUnchanged: patterns !== null });
  const renders = summarizeBatch(before).inFilter;
  const matching =
    patterns === null
      ? null
      : filterStories(
          renders.map((render) => ({ ...render, id: render.story })),
          patterns,
        );
  const chosen: readonly ComparedRender[] = stories !== "all" && "targets" in stories ? exactly(renders, stories.targets) : (matching?.stories ?? renders);
  const decided = chosen.filter(({ state }) => isDecidable(state));
  const { batch } = before;
  await project.batches.decide({
    environment: batch.environment,
    decision,
    actor,
    renders: decided.map(({ story, imageHash }) => ({ story, imageHash })),
    on: { batchId, gitSha: batch.gitSha },
  });
  return {
    decided,
    skipped: chosen.filter(({ state }) => state === "failed"),
    unmatchedPatterns: matching?.unmatched ?? [],
    comparison: await compareAsReviewed(project, batchId),
  };
}
