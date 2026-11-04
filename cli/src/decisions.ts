// Deciding on and accepting a batch, from what the store knows about it, whether or not its
// exported images are still on disk.
import { filterStories } from "selfie-render";
import { BatchError, type ComparedRender, type Comparison, type DecisionKind } from "selfie-store";
import type { AcceptRefusal, DecisionTarget } from "selfie-ui/app";
import { SelfieError } from "./errors.ts";
import { isOnBaselineHistory } from "./git.ts";
import { compareAsReviewed, type Project } from "./project.ts";
import { isDecidable, summarizeBatch } from "./summary.ts";

export interface DecideRequest {
  readonly batchId: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  /**
   * Every changed and new image, those whose story IDs match these patterns, or exactly these
   * images, for a caller that showed them, which refuses all of them if any is out of date.
   */
  readonly stories: "all" | readonly string[] | { readonly targets: readonly DecisionTarget[] };
}

export interface DecideResult {
  /** The images that took the decision. */
  readonly decided: readonly ComparedRender[];
  /** What was selected, but has no image to decide on. */
  readonly skipped: readonly ComparedRender[];
  /** Patterns that matched nothing, which a caller shouldn't read as a decision made. */
  readonly unmatchedPatterns: readonly string[];
  /** The batch as it stands after this decision. */
  readonly comparison: Comparison;
}

/** Exactly these rows, each still holding the image named, or nothing is decided. */
function exactly(renders: readonly ComparedRender[], targets: readonly DecisionTarget[]): readonly ComparedRender[] {
  const rows = new Map(renders.filter(({ state }) => isDecidable(state)).map((row) => [row.story, row]));
  const stale = targets.filter(({ story, imageHash }) => rows.get(story)?.imageHash !== imageHash);
  if (stale.length > 0) {
    throw new SelfieError(
      "stale-decision",
      `${stale.length} of these images aren't what this batch holds now, so nothing was decided. Look again.`,
    );
  }
  return targets.map(({ story }) => rows.get(story)!);
}

export async function decide(project: Project, { batchId, decision, actor, stories }: DecideRequest): Promise<DecideResult> {
  const patterns = stories === "all" || "targets" in stories ? null : stories;
  // Unchanged rows only say whether a pattern matched anything.
  const before = await compareAsReviewed(project, batchId, { includeUnchanged: patterns !== null });
  const matching =
    patterns === null
      ? null
      : filterStories(
          before.renders.map((render) => ({ ...render, id: render.story })),
          patterns,
        );
  const chosen: readonly ComparedRender[] =
    stories !== "all" && "targets" in stories ? exactly(before.renders, stories.targets) : (matching?.stories ?? before.renders);
  const decided = chosen.filter(({ state }) => isDecidable(state));
  await project.batches.decide({
    environment: before.batch.environment,
    decision,
    actor,
    renders: decided.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
  });
  return {
    decided,
    skipped: chosen.filter(({ state }) => state === "failed" || state === "removed"),
    unmatchedPatterns: matching?.unmatched ?? [],
    comparison: await project.batches.compareBatch(batchId, before.batch.baselineSha),
  };
}

export type { AcceptRefusal };

export interface AcceptRequest {
  readonly batchId: string;
  /** How many removed renders the reviewer saw. Needed if there are any. */
  readonly removedSeen?: number | undefined;
}

export interface AcceptCheck {
  /** Every reason at once, so a caller doesn't fix them one batch at a time. */
  readonly refusals: readonly AcceptRefusal[];
  /** Whether the batch's SHA is where a later review could read goldens from. */
  readonly usableAsBaseline: boolean;
  /** The goldens accepting would drop, and how many of them only the batch's filter left out. */
  readonly removals: { readonly stories: readonly string[]; readonly outsideFilter: number };
}

export interface AcceptResult extends Omit<AcceptCheck, "removals"> {
  readonly accepted: boolean;
  readonly comparison: Comparison;
}

/** What `accept` would refuse of a comparison a caller holds, changing nothing. */
export async function checkAccept(project: Project, comparison: Comparison, removedSeen?: number): Promise<AcceptCheck> {
  const { batch } = comparison;
  const { failed, unapproved, removed, notRendered } = summarizeBatch(comparison);
  const removals = { stories: [...removed, ...notRendered].map(({ story }) => story).sort(), outsideFilter: notRendered.length };

  const refusals: AcceptRefusal[] = [];
  if (batch.dirty) refusals.push({ reason: "recorded-on-dirty-tree", gitSha: batch.gitSha });
  if (failed.length > 0) refusals.push({ reason: "batch-has-failures", stories: failed.map(({ story }) => story) });
  if (unapproved.length > 0) {
    refusals.push({
      reason: "unapproved",
      stories: unapproved.map(({ story, state, decision }) => ({
        story,
        state,
        decision: decision?.decision ?? null,
      })),
    });
  }
  if (removedSeen === undefined && removals.stories.length > 0) {
    refusals.push({ reason: "removed-unacknowledged", ...removals });
  } else if (removedSeen !== undefined && removedSeen !== removals.stories.length) {
    refusals.push({ reason: "wrong-removed-count", ...removals, seen: removedSeen });
  }

  return { refusals, usableAsBaseline: await isOnBaselineHistory(project.repo, batch.gitSha), removals };
}

export async function accept(project: Project, { batchId, removedSeen }: AcceptRequest): Promise<AcceptResult> {
  const comparison = await compareAsReviewed(project, batchId);
  const { refusals, usableAsBaseline, removals } = await checkAccept(project, comparison, removedSeen);
  const { batch } = comparison;
  const result = (list: readonly AcceptRefusal[], accepted: boolean): AcceptResult => ({
    accepted,
    refusals: list,
    usableAsBaseline,
    comparison,
  });
  if (refusals.length > 0) return result(refusals, false);

  // Nothing above stands in for this: the store's one statement is what makes it so.
  try {
    const accepted = await project.batches.acceptBatch(batchId, batch.baselineSha, removedSeen ?? 0);
    return result(accepted ? [] : [{ reason: "unapproved", stories: [] }], accepted);
  } catch (error) {
    // Another writer can move a baseline's goldens between the check above and this.
    if (error instanceof BatchError && error.code === "wrong-removed-count") {
      return result([{ reason: "wrong-removed-count", ...removals, seen: removedSeen ?? 0 }], false);
    }
    throw error;
  }
}
