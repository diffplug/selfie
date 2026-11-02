// Deciding on and accepting a run, from what the store knows about it, whether or not its
// exported images are still on disk.
import { filterStories } from "selfie-render";
import { SnapshotError, type ComparedSnapshot, type Comparison, type DecisionKind } from "selfie-store";
import { isOnBaselineHistory } from "./git.ts";
import { compareAsReviewed, type Project } from "./project.ts";
import { isDecidable, summarizeRun } from "./summary.ts";

export interface DecideRequest {
  readonly runId: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  /** Every changed and new image, or those whose story IDs match these patterns. */
  readonly stories: "all" | readonly string[];
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

export async function decide(project: Project, request: DecideRequest): Promise<DecideResult> {
  const { runId, decision, actor, stories } = request;
  const before = await compareAsReviewed(project, runId, { includeUnchanged: true });
  const matching =
    stories === "all"
      ? null
      : filterStories(
          before.snapshots.map((snapshot) => ({ ...snapshot, id: snapshot.story })),
          stories,
        );
  const chosen: readonly ComparedSnapshot[] = matching?.stories ?? before.snapshots;
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
    comparison: await compareAsReviewed(project, runId),
  };
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

export interface AcceptRequest {
  readonly runId: string;
  /** How many removed snapshots the reviewer saw. Needed if there are any. */
  readonly removedSeen?: number | undefined;
}

export interface AcceptResult {
  readonly accepted: boolean;
  /** Empty if accepted. Every reason at once, so a caller doesn't fix them one run at a time. */
  readonly refusals: readonly AcceptRefusal[];
  /** Whether the run's SHA is where a later review could read goldens from. */
  readonly usableAsBaseline: boolean;
  readonly comparison: Comparison;
}

export async function accept(project: Project, { runId, removedSeen }: AcceptRequest): Promise<AcceptResult> {
  const comparison = await compareAsReviewed(project, runId);
  const { run } = comparison;
  const { failed, unapproved, removed, notRendered } = summarizeRun(comparison);
  const removedStories = [...removed, ...notRendered].map(({ story }) => story).sort();
  const removalFacts = { stories: removedStories, outsideFilter: notRendered.length };

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
  if (removedSeen === undefined && removedStories.length > 0) {
    refusals.push({ reason: "removed-unacknowledged", ...removalFacts });
  } else if (removedSeen !== undefined && removedSeen !== removedStories.length) {
    refusals.push({ reason: "wrong-removed-count", ...removalFacts, seen: removedSeen });
  }

  const usableAsBaseline = await isOnBaselineHistory(project.repo, run.gitSha);
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
      return result([{ reason: "wrong-removed-count", ...removalFacts, seen: removedSeen ?? 0 }], false);
    }
    throw error;
  }
}
