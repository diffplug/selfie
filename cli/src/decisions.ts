// Deciding on and accepting a run, from what the store knows about it, whether or not its
// exported images are still on disk.
import { filterStories } from "selfie-render";
import { SnapshotError, type ComparedSnapshot, type Comparison, type DecisionKind } from "selfie-store";
import type { AcceptRefusal, DecisionTarget } from "selfie-ui/app";
import { SelfieError } from "./errors.ts";
import { isOnBaselineHistory } from "./git.ts";
import { compareAsReviewed, type Project } from "./project.ts";
import { isDecidable, summarizeRun } from "./summary.ts";

export interface DecideRequest {
  readonly runId: string;
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
  readonly decided: readonly ComparedSnapshot[];
  /** What was selected, but has no image to decide on. */
  readonly skipped: readonly ComparedSnapshot[];
  /** Patterns that matched nothing, which a caller shouldn't read as a decision made. */
  readonly unmatchedPatterns: readonly string[];
  /** The run as it stands after this decision. */
  readonly comparison: Comparison;
}

/** Exactly these rows, each still holding the image named, or nothing is decided. */
function exactly(snapshots: readonly ComparedSnapshot[], targets: readonly DecisionTarget[]): readonly ComparedSnapshot[] {
  const rows = new Map(snapshots.filter(({ state }) => isDecidable(state)).map((row) => [row.story, row]));
  const stale = targets.filter(({ story, imageHash }) => rows.get(story)?.imageHash !== imageHash);
  if (stale.length > 0) {
    throw new SelfieError(
      "stale-decision",
      `${stale.length} of these images aren't what this run holds now, so nothing was decided. Look again.`,
    );
  }
  return targets.map(({ story }) => rows.get(story)!);
}

export async function decide(project: Project, { runId, decision, actor, stories }: DecideRequest): Promise<DecideResult> {
  const patterns = stories === "all" || "targets" in stories ? null : stories;
  // Unchanged rows only say whether a pattern matched anything.
  const before = await compareAsReviewed(project, runId, { includeUnchanged: patterns !== null });
  const matching =
    patterns === null
      ? null
      : filterStories(
          before.snapshots.map((snapshot) => ({ ...snapshot, id: snapshot.story })),
          patterns,
        );
  const chosen: readonly ComparedSnapshot[] =
    stories !== "all" && "targets" in stories ? exactly(before.snapshots, stories.targets) : (matching?.stories ?? before.snapshots);
  const decided = chosen.filter(({ state }) => isDecidable(state));
  await project.snapshots.decide({
    environment: before.run.environment,
    decision,
    actor,
    snapshots: decided.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
  });
  return {
    decided,
    skipped: chosen.filter(({ state }) => state === "failed" || state === "removed"),
    unmatchedPatterns: matching?.unmatched ?? [],
    comparison: await project.snapshots.compareRun(runId, before.run.baselineSha),
  };
}

export type { AcceptRefusal };

export interface AcceptRequest {
  readonly runId: string;
  /** How many removed snapshots the reviewer saw. Needed if there are any. */
  readonly removedSeen?: number | undefined;
}

export interface AcceptCheck {
  /** Every reason at once, so a caller doesn't fix them one run at a time. */
  readonly refusals: readonly AcceptRefusal[];
  /** Whether the run's SHA is where a later review could read goldens from. */
  readonly usableAsBaseline: boolean;
  /** The goldens accepting would drop, and how many of them only the run's filter left out. */
  readonly removals: { readonly stories: readonly string[]; readonly outsideFilter: number };
}

export interface AcceptResult extends Omit<AcceptCheck, "removals"> {
  readonly accepted: boolean;
  readonly comparison: Comparison;
}

/** What `accept` would refuse of a comparison a caller holds, changing nothing. */
export async function checkAccept(project: Project, comparison: Comparison, removedSeen?: number): Promise<AcceptCheck> {
  const { run } = comparison;
  const { failed, unapproved, removed, notRendered } = summarizeRun(comparison);
  const removals = { stories: [...removed, ...notRendered].map(({ story }) => story).sort(), outsideFilter: notRendered.length };

  const refusals: AcceptRefusal[] = [];
  if (run.dirty) refusals.push({ reason: "recorded-on-dirty-tree", gitSha: run.gitSha });
  if (failed.length > 0) refusals.push({ reason: "run-has-failures", stories: failed.map(({ story }) => story) });
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

  return { refusals, usableAsBaseline: await isOnBaselineHistory(project.repo, run.gitSha), removals };
}

export async function accept(project: Project, { runId, removedSeen }: AcceptRequest): Promise<AcceptResult> {
  const comparison = await compareAsReviewed(project, runId);
  const { refusals, usableAsBaseline, removals } = await checkAccept(project, comparison, removedSeen);
  const { run } = comparison;
  const result = (list: readonly AcceptRefusal[], accepted: boolean): AcceptResult => ({
    accepted,
    refusals: list,
    usableAsBaseline,
    comparison,
  });
  if (refusals.length > 0) return result(refusals, false);

  // Nothing above stands in for this: the store's one statement is what makes it so.
  try {
    const accepted = await project.snapshots.acceptRun(runId, run.baselineSha, removedSeen ?? 0);
    return result(accepted ? [] : [{ reason: "unapproved", stories: [] }], accepted);
  } catch (error) {
    // Another writer can move a baseline's goldens between the check above and this.
    if (error instanceof SnapshotError && error.code === "wrong-removed-count") {
      return result([{ reason: "wrong-removed-count", ...removals, seen: removedSeen ?? 0 }], false);
    }
    throw error;
  }
}
