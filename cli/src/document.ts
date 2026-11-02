// What the CLI prints, as pure functions from the library's results. All command wording lives
// here, since none of it belongs in anything a store or a UI would keep.
import type { AcceptRefusal, AcceptResult } from "./decisions.ts";
import type { RecordResult, ReviewResult } from "./review.ts";
import { summarizeRun, type RunSummary } from "./summary.ts";

const DIRTY_PATHS_SHOWN = 20;

function nextSteps(result: ReviewResult, checked: RunSummary): string[] {
  const { comparison, baseline, given, branchGoldens } = result;
  const { id: runId, gitSha, dirty, baselineSha } = comparison.run;
  const steps: string[] = [];
  if (given !== null) {
    return [
      `This compared with ${given.run ?? given.sha} for this review alone. selfie approve and selfie accept still compare with ${baselineSha ?? "no baseline"}, the baseline this run recorded.`,
    ];
  }
  if (checked.counts.undecided > 0) {
    steps.push(`Look at the images, then: selfie approve ${runId} --all, or with --story <pattern>, or selfie reject.`);
  }
  if (checked.failed.length > 0) steps.push("A run with failed stories can't be accepted. Fix them and review again.");

  if (baseline.sha === null && baseline.mergeBase !== null && baseline.mergeBase !== gitSha) {
    const shown =
      branchGoldens === null
        ? "There's no baseline yet. Goldens accepted on this branch only show later reviews here what changed."
        : `There's no baseline yet, so this compared with ${branchGoldens}, the nearest goldens on this branch. That's only to look at: accepting still needs every image approved, including the ones that match.`;
    steps.push(`${shown} To make a baseline, accept on ${baseline.defaultBranch ?? "the default branch"} once a commit there has these stories.`);
  }
  if (dirty) {
    steps.push("This tree is dirty, so this run can't become goldens. Commit, and review again: approvals carry over.");
  } else if (result.differences.length > 0 && checked.failed.length === 0) {
    const removed = checked.removed.length + checked.notRendered.length;
    steps.push(
      `Once every image is approved, make this run its commit's goldens: selfie accept ${runId}${removed > 0 ? ` --removed ${removed}` : ""}`,
    );
  }
  return steps;
}

/** The one document `selfie review` prints. */
export function buildReviewDocument(result: ReviewResult) {
  const { comparison, reviewed, baseline, given, branchGoldens, dirtyPaths, differences, playErrors, warnings } = result;
  const { run } = comparison;
  const shown = summarizeRun(comparison);
  // What stops accepting comes from what accepting checks, whatever this shows.
  const checked = reviewed === comparison ? shown : summarizeRun(reviewed);
  return {
    schemaVersion: 1,
    runId: run.id,
    reusedFromRun: run.reusedFromRun,
    gitSha: run.gitSha,
    dirty: run.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    baseline: { sha: baseline.sha, reason: baseline.reason, message: baseline.message },
    comparedWith:
      given !== null
        ? { source: "given", sha: given.sha ?? null, run: given.run ?? null }
        : branchGoldens !== null
          ? { source: "branch", sha: branchGoldens, run: null }
          : { source: "baseline", sha: baseline.sha, run: null },
    environment: run.environment,
    filter:
      run.storyFilter === null
        ? null
        : { patterns: run.storyFilter.patterns, notRendered: shown.notRendered.length },
    counts: { ...shown.counts, undecided: checked.counts.undecided },
    blockers: checked.blockers,
    advisories: shown.advisories,
    differences,
    playErrors,
    warnings,
    next: nextSteps(result, checked),
  };
}

/** The one document `selfie record` prints. It only says what was recorded: judging it is `selfie review`'s. */
export function buildRecordDocument({ run, dirtyPaths, baseline, warnings }: RecordResult) {
  return {
    schemaVersion: 1,
    runId: run.id,
    gitSha: run.gitSha,
    dirty: run.dirty,
    dirtyPaths: dirtyPaths.slice(0, DIRTY_PATHS_SHOWN),
    baseline: { sha: baseline.sha, reason: baseline.reason, message: baseline.message },
    environment: run.environment,
    status: run.status,
    failedCount: run.failedCount,
    warnings,
    next: [`See what it changed: selfie review ${run.id}`, `Compare it with another run: selfie review ${run.id} --baseline <run>`],
  };
}

function refusalMessage(refusal: AcceptRefusal, runId: string): string {
  switch (refusal.reason) {
    case "recorded-on-dirty-tree":
      return `This run was recorded on a dirty tree at ${refusal.gitSha}, so its images don't describe that commit. Run selfie review on a clean tree and accept that run: approvals carry over.`;
    case "run-has-failures":
      return `A run with failures can't become goldens. Stories that failed to render (${refusal.stories.length}): ${refusal.stories.join(", ")}.`;
    case "unapproved": {
      const names = refusal.stories.map(
        ({ story, state, decision }) => `${story} (${state}${decision === null ? "" : `, ${decision}`})`,
      );
      return `Images not approved (${names.length}): ${names.join(", ")}. Use selfie approve ${runId} --all, or --story <pattern>.`;
    }
    case "removed-unacknowledged":
    case "wrong-removed-count": {
      const count = refusal.stories.length;
      const given = refusal.reason === "wrong-removed-count" ? ` You said ${refusal.seen}.` : "";
      const outside =
        refusal.outsideFilter > 0
          ? ` Of those, ${refusal.outsideFilter} are only outside this run's --story filter, so a run without a filter may be what you want.`
          : "";
      return `Goldens that accepting would remove (${count}): ${refusal.stories.join(", ")}.${given}${outside} If that is right, pass --removed ${count}.`;
    }
  }
}

/** The one document `selfie accept` prints. */
export function buildAcceptDocument({ accepted, refusals, usableAsBaseline, comparison }: AcceptResult) {
  const { run } = comparison;
  const { advisories, removed, notRendered } = summarizeRun(comparison);
  return {
    accepted,
    runId: run.id,
    reusedFromRun: run.reusedFromRun,
    gitSha: run.gitSha,
    environment: run.environment,
    baselineSha: run.baselineSha,
    usableAsBaseline,
    removed: [...removed, ...notRendered].map(({ story }) => story).sort(),
    refusals: refusals.map((refusal) => ({ ...refusal, message: refusalMessage(refusal, run.id) })),
    advisories,
  };
}
