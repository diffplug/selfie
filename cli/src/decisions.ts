// `selfie approve`, `selfie reject`, and `selfie accept`. Each acts on a run's record, which holds
// the baseline its reviewer saw.
import { filterStories } from "selfie-render";
import { SnapshotError, type ComparedSnapshot, type DecisionKind } from "selfie-store";
import { dirtyPaths, gitUserEmail } from "./git.ts";
import { CliError, EXIT_NEEDS_ATTENTION, EXIT_OK, printJson, type Context } from "./output.ts";
import { assertRunId } from "./paths.ts";
import { openProject, readRunRecord } from "./project.ts";
import type { ReviewOutput } from "./review.ts";

const asEntry = ({ story }: { story: string }) => ({ id: story, title: "", name: "" });

export interface DecideFlags {
  readonly run: string;
  readonly decision: DecisionKind;
  readonly all?: boolean | undefined;
  readonly story?: string[] | undefined;
  readonly actor?: string | undefined;
}

export async function decideCommand(flags: DecideFlags, context: Context): Promise<number> {
  const { run: runId, decision, all, story: patterns } = flags;
  assertRunId(runId);
  if (Boolean(all) === Boolean(patterns?.length)) {
    throw new CliError("Say which snapshots: either --all, or one or more --story patterns.");
  }

  const project = await openProject(context);
  try {
    const actor = flags.actor ?? (await gitUserEmail(project.repo));
    if (actor === null) throw new CliError("No actor: set git config user.email, or pass --actor.");
    const { baselineSha } = await readRunRecord<ReviewOutput>(project, runId);
    const comparison = await project.snapshots.compareRun(runId, baselineSha, { includeUnchanged: true });

    // A typo must not read as a decision made.
    const matching = patterns === undefined ? null : filterStories(comparison.snapshots.map(asEntry), patterns);
    const chosen =
      matching === null
        ? comparison.snapshots
        : comparison.snapshots.filter(({ story }) => matching.stories.some(({ id }) => id === story));

    const decidable = ({ state }: ComparedSnapshot) => state === "changed" || state === "new";
    const decided = chosen.filter(decidable);
    const skipped = chosen.filter(({ state }) => state === "failed" || state === "removed");
    await project.snapshots.decide({
      environment: comparison.run.environment,
      decision,
      actor,
      snapshots: decided.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
    });
    const unmatchedPatterns = matching?.unmatched ?? [];

    // What still blocks accepting, now this decision is in.
    const chosenStories = new Set(decided.map(({ story }) => story));
    const undecided = comparison.snapshots.filter(
      (snapshot) => decidable(snapshot) && !chosenStories.has(snapshot.story) && snapshot.decision === null,
    );
    printJson(context, {
      runId,
      decision,
      actor,
      decided: decided.map(({ story, state, imageHash }) => ({ story, state, imageHash })),
      skipped: skipped.map(({ story, state }) => ({
        story,
        state,
        reason: state === "failed" ? "It failed to render, so it has no image." : "It was removed, so it has no image.",
      })),
      undecided: undecided.map(({ story, state }) => ({ story, state })),
      unmatchedPatterns,
    });
    return unmatchedPatterns.length > 0 ? EXIT_NEEDS_ATTENTION : EXIT_OK;
  } finally {
    project.close();
  }
}

export interface AcceptFlags {
  readonly run: string;
  /** The count of removed snapshots the reviewer saw. Required if there are any. */
  readonly removed?: number | undefined;
}

export type AcceptRefusal =
  | "dirty-tree"
  | "recorded-on-dirty-tree"
  | "run-has-failures"
  | "unapproved"
  | "removed-unacknowledged"
  | "wrong-removed-count";

export async function acceptCommand(flags: AcceptFlags, context: Context): Promise<number> {
  const { run: runId, removed: removedSeen } = flags;
  assertRunId(runId);

  const project = await openProject(context);
  try {
    const record = await readRunRecord<ReviewOutput>(project, runId);
    const { snapshots: compared, run } = await project.snapshots.compareRun(runId, record.baselineSha);
    const removed = compared.filter(({ state }) => state === "removed").map(({ story }) => story);
    const unapproved = compared
      .filter(
        ({ state, decision }) => (state === "changed" || state === "new") && decision?.decision !== "approved",
      )
      .map(({ story, state, decision }) => ({ story, state, decision: decision?.decision ?? null }));
    const failed = compared.filter(({ state }) => state === "failed").map(({ story }) => story);
    const outsideFilter =
      record.filter === null
        ? 0
        : removed.length - filterStories(removed.map((story) => asEntry({ story })), [...record.filter.patterns]).stories.length;
    const dirty = await dirtyPaths(project.repo);

    const refusals: { reason: AcceptRefusal; message: string }[] = [];
    if (dirty.length > 0) {
      refusals.push({
        reason: "dirty-tree",
        message: `The working tree is dirty (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", ..." : ""}). Commit first: a SHA's goldens must describe that commit.`,
      });
    }
    if (record.dirty) {
      refusals.push({
        reason: "recorded-on-dirty-tree",
        message: `This run was recorded on a dirty tree at ${run.gitSha}, so its images don't describe that commit. Run \`selfie review\` on a clean tree and accept that run: approvals carry over.`,
      });
    }
    if (failed.length > 0) {
      refusals.push({
        reason: "run-has-failures",
        message: `A run with failures can't become goldens. Stories that failed to render (${failed.length}): ${failed.join(", ")}.`,
      });
    }
    if (unapproved.length > 0) {
      const names = unapproved.map(({ story, state, decision }) => `${story} (${state}${decision === null ? "" : `, ${decision}`})`);
      refusals.push({
        reason: "unapproved",
        message: `Images not approved (${unapproved.length}): ${names.join(", ")}. Use selfie approve ${runId} --all, or --story <pattern>.`,
      });
    }
    if (removed.length > 0 && removedSeen === undefined) {
      refusals.push({
        reason: "removed-unacknowledged",
        message: `Goldens that accepting would remove (${removed.length}): ${removed.join(", ")}.${outsideFilter > 0 ? ` Of those, ${outsideFilter} are only outside this run's --story filter, so a run without a filter may be what you want.` : ""} If that is right, pass --removed ${removed.length}.`,
      });
    }

    const attention = { playErrors: record.playErrors, unstable: record.unstable };
    const summary = { runId, gitSha: run.gitSha, environment: run.environment, baselineSha: record.baselineSha, removed };
    const refuse = (list: typeof refusals) => {
      context.stderr(`Not accepted:\n${list.map(({ message }) => `  ${message}`).join("\n")}\n`);
      printJson(context, { accepted: false, ...summary, refusals: list, unapproved, ...attention });
      return EXIT_NEEDS_ATTENTION;
    };
    if (refusals.length > 0) return refuse(refusals);

    let accepted: boolean;
    try {
      accepted = await project.snapshots.acceptRun(runId, record.baselineSha, removedSeen ?? 0);
    } catch (error) {
      if (error instanceof SnapshotError && error.code === "wrong-removed-count") {
        return refuse([{ reason: "wrong-removed-count", message: error.message }]);
      }
      throw error;
    }
    if (!accepted) {
      return refuse([
        { reason: "unapproved", message: "An image lost its approval while accepting. Review the run again." },
      ]);
    }
    printJson(context, { accepted: true, ...summary, ...attention });
    return EXIT_OK;
  } finally {
    project.close();
  }
}
