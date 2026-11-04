// What the CLI prints, as pure functions from the library's results. All command wording lives
// here, since none of it belongs in anything a store or a UI would keep.
import type { AcceptRefusal, AcceptResult } from "./decisions.ts";
import { groupHunks } from "selfie-ui/hunks";
import type { RenderBatchResult, ReviewResult } from "./review.ts";
import { summarizeBatch, type BatchSummary } from "./summary.ts";

const DIRTY_PATHS_SHOWN = 20;

function nextSteps(result: ReviewResult, checked: BatchSummary): string[] {
  const { comparison, baseline, given, branchGoldens } = result;
  const { id: batchId, gitSha, dirty, baselineSha } = comparison.batch;
  const steps: string[] = [];
  if (given !== null) {
    return [
      `This compared with ${given.batch ?? given.sha} for this review alone. selfie approve and selfie accept still compare with ${baselineSha ?? "no baseline"}, the baseline this batch recorded.`,
    ];
  }
  if (checked.counts.undecided > 0) {
    steps.push(`Look at the images, then: selfie approve ${batchId} --all, or with --story <pattern>, or selfie reject.`);
  }
  if (checked.failed.length > 0) steps.push("A batch with failed stories can't be accepted. Fix them and review again.");

  if (baseline.sha === null && baseline.mergeBase !== null && baseline.mergeBase !== gitSha) {
    const shown =
      branchGoldens === null
        ? "There's no baseline yet. Goldens accepted on this branch only show later reviews here what changed."
        : `There's no baseline yet, so this compared with ${branchGoldens}, the nearest goldens on this branch. That's only to look at: accepting still needs every image approved, including the ones that match.`;
    steps.push(`${shown} To make a baseline, accept on ${baseline.defaultBranch ?? "the default branch"} once a commit there has these stories.`);
  }
  if (dirty) {
    steps.push("This tree is dirty, so this batch can't become goldens. Commit, and review again: approvals carry over.");
  } else if (result.differences.length > 0 && checked.failed.length === 0) {
    const removed = checked.removed.length + checked.notRendered.length;
    steps.push(
      `Once every image is approved, make this batch its commit's goldens: selfie accept ${batchId}${removed > 0 ? ` --removed ${removed}` : ""}`,
    );
  }
  return steps;
}

/** The one document `selfie review` prints. */
export function buildReviewDocument(result: ReviewResult) {
  const { comparison, reviewed, baseline, given, branchGoldens, hunkMergeDistance, dirtyPaths, differences, playErrors, warnings } = result;
  const { batch } = comparison;
  const shown = summarizeBatch(comparison);
  // What stops accepting comes from what accepting checks, whatever this shows.
  const checked = reviewed === comparison ? shown : summarizeBatch(reviewed);
  return {
    schemaVersion: 1,
    batchId: batch.id,
    reusedFromBatch: batch.reusedFromBatch,
    gitSha: batch.gitSha,
    dirty: batch.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    baseline: { sha: baseline.sha, reason: baseline.reason, message: baseline.message },
    comparedWith:
      given !== null
        ? { source: "given", sha: given.sha ?? null, batch: given.batch ?? null }
        : branchGoldens !== null
          ? { source: "branch", sha: branchGoldens, batch: null }
          : { source: "baseline", sha: baseline.sha, batch: null },
    environment: batch.environment,
    filter:
      batch.storyFilter === null
        ? null
        : { patterns: batch.storyFilter.patterns, notRendered: shown.notRendered.length },
    counts: { ...shown.counts, undecided: checked.counts.undecided },
    blockers: checked.blockers,
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
    next: nextSteps(result, checked),
  };
}

/** The one document `selfie render` prints. It only says what was recorded: judging it is `selfie review`'s. */
export function buildRenderDocument({ batch, dirtyPaths, baseline, warnings }: RenderBatchResult) {
  return {
    schemaVersion: 1,
    batchId: batch.id,
    gitSha: batch.gitSha,
    dirty: batch.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    baseline: { sha: baseline.sha, reason: baseline.reason, message: baseline.message },
    environment: batch.environment,
    status: batch.status,
    failedCount: batch.failedCount,
    warnings,
    next: [`See what it changed: selfie review ${batch.id}`, `Compare it with another batch: selfie review ${batch.id} --baseline <batch>`],
  };
}

function refusalMessage(refusal: AcceptRefusal, batchId: string): string {
  switch (refusal.reason) {
    case "recorded-on-dirty-tree":
      return `This batch was recorded on a dirty tree at ${refusal.gitSha}, so its images don't describe that commit. Run selfie review on a clean tree and accept that batch: approvals carry over.`;
    case "batch-has-failures":
      return `A batch with failures can't become goldens. Stories that failed to render (${refusal.stories.length}): ${refusal.stories.join(", ")}.`;
    case "unapproved": {
      const names = refusal.stories.map(
        ({ story, state, decision }) => `${story} (${state}${decision === null ? "" : `, ${decision}`})`,
      );
      return `Images not approved (${names.length}): ${names.join(", ")}. Use selfie approve ${batchId} --all, or --story <pattern>.`;
    }
    case "removed-unacknowledged":
    case "wrong-removed-count": {
      const count = refusal.stories.length;
      const given = refusal.reason === "wrong-removed-count" ? ` You said ${refusal.seen}.` : "";
      const outside =
        refusal.outsideFilter > 0
          ? ` Of those, ${refusal.outsideFilter} are only outside this batch's --story filter, so a batch without a filter may be what you want.`
          : "";
      return `Goldens that accepting would remove (${count}): ${refusal.stories.join(", ")}.${given}${outside} If that is right, pass --removed ${count}.`;
    }
  }
}

/** The one document `selfie accept` prints. */
export function buildAcceptDocument({ accepted, refusals, usableAsBaseline, comparison }: AcceptResult) {
  const { batch } = comparison;
  const { advisories, removed, notRendered } = summarizeBatch(comparison);
  return {
    accepted,
    batchId: batch.id,
    reusedFromBatch: batch.reusedFromBatch,
    gitSha: batch.gitSha,
    environment: batch.environment,
    baselineSha: batch.baselineSha,
    usableAsBaseline,
    removed: [...removed, ...notRendered].map(({ story }) => story).sort(),
    refusals: refusals.map((refusal) => ({ ...refusal, message: refusalMessage(refusal, batch.id) })),
    advisories,
  };
}
