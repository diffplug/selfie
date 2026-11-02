// The review UI's window on a local repository: the library, as the shape its routes want. Nothing
// here renders, so the UI only reads what `selfie review` recorded and records decisions on it.
import type { Comparison, DecisionKind } from "selfie-store";
import type { AcceptOutcome, CurrentView, DecisionTarget, ReviewSource, RunView, SnapshotRow } from "selfie-ui/app";
import { resolveCaptureSettings } from "./config.ts";
import { accept, checkAccept, decide } from "./decisions.ts";
import { diffFiles, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail, headSha, type BaselineSearch } from "./git.ts";
import { compareAsReviewed, findBaseline, readReviewCache, type Project } from "./project.ts";
import { summarizeRun } from "./summary.ts";

/** Each is about 20 KB of PNG. This is a reviewer going back and forth, not a cache of a run. */
const DIFFS_KEPT = 32;

const baselineNote = ({ sha, message }: BaselineSearch) => ({ sha, message });

export function localReviewSource(project: Project, { native }: { readonly native?: boolean | undefined } = {}): ReviewSource {
  const { snapshots, store, repo } = project;

  /** A corrupt cache costs only pixel stats in a list, so it isn't worth failing a page over. */
  const cachedDiffs = async (runId: string): Promise<ReadonlyMap<string, PixelDiff>> => {
    const cache = await readReviewCache(project, runId).catch(() => null);
    return new Map(
      (cache?.differences ?? []).flatMap(({ story, pixelDiff }) => (pixelDiff === null ? [] : [[story, pixelDiff]])),
    );
  };

  const toRows = async (runId: string, compared: Comparison["snapshots"]): Promise<SnapshotRow[]> => {
    const pixelDiffs = await cachedDiffs(runId);
    return compared.map((snapshot) => ({ ...snapshot, pixelDiff: pixelDiffs.get(snapshot.story) ?? null }));
  };

  /** Everything recomputed from one comparison, which the caller already has. */
  const viewOf = async (comparison: Comparison, actor: string | null): Promise<RunView> => {
    const { run } = comparison;
    const summary = summarizeRun(comparison);
    const notRendered = new Set(summary.notRendered.map(({ story }) => story));
    const { refusals, usableAsBaseline, removals } = await checkAccept(project, comparison);
    return {
      run,
      acceptedRunId: await snapshots.acceptedRunAt(run.gitSha, run.environment),
      actor,
      blockers: summary.blockers,
      advisories: summary.advisories,
      counts: { ...summary.counts, failed: summary.failed.length },
      rows: await toRows(
        run.id,
        comparison.snapshots.filter(({ story }) => !notRendered.has(story)),
      ),
      refusals,
      removals,
      usableAsBaseline,
      siblings: (await snapshots.runsAt(run.gitSha, run.environment)).map(({ id, startedAt, status, dirty }) => ({ id, startedAt, status, dirty })),
    };
  };

  /** Diffs by content, so any run that compares these two images shares the work. */
  const diffs = new Map<string, { diff: PixelDiff; png: Uint8Array | null }>();

  return {
    runView: async (runId) => viewOf(await compareAsReviewed(project, runId), await gitUserEmail(repo)),

    async current(): Promise<CurrentView> {
      const { environmentId: environment } = await resolveCaptureSettings(repo, { native });
      const head = await headSha(repo);
      const runs = head === null ? [] : await snapshots.runsAt(head, environment);
      const runId = runs.find(({ status }) => status !== "recording")?.id ?? null;
      return {
        head,
        runId,
        hasUnfinishedRun: runs.length > 0,
        baseline: runId === null ? baselineNote(await findBaseline(project, environment)) : null,
      };
    },

    async baseline(runId) {
      const { run } = await compareAsReviewed(project, runId);
      return baselineNote(await findBaseline(project, run.environment));
    },

    async unchanged(runId) {
      const { snapshots: compared } = await compareAsReviewed(project, runId, { includeUnchanged: true });
      return toRows(
        runId,
        compared.filter(({ state }) => state === "unchanged"),
      );
    },

    async decide(runId: string, decision: DecisionKind, targets: readonly DecisionTarget[]) {
      const actor = await gitUserEmail(repo);
      if (actor === null) {
        throw new SelfieError("no-actor", "Git doesn't say who you are, so no decision was recorded. Set git config user.email.");
      }
      const { comparison } = await decide(project, { runId, decision, actor, stories: { targets } });
      return viewOf(comparison, actor);
    },

    async accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome> {
      const { accepted, refusals, comparison } = await accept(project, { runId, removedSeen });
      return { accepted, refusals, view: await viewOf(comparison, await gitUserEmail(repo)) };
    },

    image: (hash) => store.getImage(hash),

    async diff(current, golden) {
      const key = `${current}/${golden}`;
      const known = diffs.get(key);
      if (known !== undefined) {
        // Newest last, so the oldest is the one to drop.
        diffs.delete(key);
        diffs.set(key, known);
        return known;
      }
      const [currentFile, goldenFile] = await Promise.all([store.getImage(current), store.getImage(golden)]);
      if (currentFile === null || goldenFile === null) return null;
      const result = await diffFiles(currentFile, goldenFile);
      diffs.set(key, result);
      for (const oldest of diffs.keys()) {
        if (diffs.size <= DIFFS_KEPT) break;
        diffs.delete(oldest);
      }
      return result;
    },
  };
}
