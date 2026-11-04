// What the CLI prints, as pure functions from the library's results. All command wording lives
// here, since none of it belongs in anything a store or a UI would keep.
import { groupHunks } from "selfie-ui/hunks";
import type { RenderBatchResult, ReviewResult } from "./review.ts";
import { summarizeBatch, type BatchSummary } from "./summary.ts";

const DIRTY_PATHS_SHOWN = 20;

function nextSteps({ comparison, given }: ReviewResult, checked: BatchSummary): string[] {
  const { id: batchId } = comparison.batch;
  if (given !== null) {
    return [`This compared with ${given.batch ?? given.sha} for this review alone. selfie approve still decides on what differs from what history has approved.`];
  }
  const steps: string[] = [];
  if (checked.counts.undecided > 0) {
    steps.push(`Look at the images, then: selfie approve ${batchId} --all, or with --story <pattern>, or selfie reject.`);
  }
  if (checked.failed.length > 0) steps.push("Stories that failed to render have no image to approve. Fix them and review again.");
  return steps;
}

/** The one document `selfie review` prints. */
export function buildReviewDocument(result: ReviewResult) {
  const { comparison, given, hunkMergeDistance, dirtyPaths, differences, playErrors, warnings } = result;
  const { batch } = comparison;
  const shown = summarizeBatch(comparison);
  return {
    schemaVersion: 1,
    batchId: batch.id,
    reusedFromBatch: batch.reusedFromBatch,
    gitSha: batch.gitSha,
    dirty: batch.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    comparedWith: given === null ? { source: "approvals", sha: null, batch: null } : { source: "given", sha: given.sha ?? null, batch: given.batch ?? null },
    environment: batch.environment,
    filter:
      batch.storyFilter === null
        ? null
        : { patterns: batch.storyFilter.patterns, notRendered: shown.notRendered.length },
    counts: shown.counts,
    blockers: shown.blockers,
    advisories: shown.advisories,
    differences: differences.map((difference) => ({
      ...difference,
      hunkGroups:
        difference.pixelDiff === null
          ? null
          : groupHunks(difference.pixelDiff.hunks, hunkMergeDistance).map(({ current, golden, kind }) => ({ current, golden, kind })),
    })),
    playErrors,
    warnings,
    next: nextSteps(result, shown),
  };
}

/** The one document `selfie render` prints. It only says what was recorded: judging it is `selfie review`'s. */
export function buildRenderDocument({ batch, dirtyPaths, warnings }: RenderBatchResult) {
  return {
    schemaVersion: 1,
    batchId: batch.id,
    gitSha: batch.gitSha,
    dirty: batch.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    environment: batch.environment,
    status: batch.status,
    failedCount: batch.failedCount,
    warnings,
    next: [`See what it changed: selfie review ${batch.id}`, `Compare it with another batch: selfie review ${batch.id} --baseline <batch>`],
  };
}
