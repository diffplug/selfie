// The review UI's window on a local repository: the library, as the shape its routes want. Nothing
// here renders, so the UI only reads what `selfie review` recorded and records decisions on it.
import { decodeImage, type ComparedSnapshot, type DecisionKind } from "selfie-store";
import type { AcceptOutcome, CurrentView, DecisionTarget, ReviewSource, RunView, SnapshotRow } from "selfie-ui";
import { resolveCaptureSettings } from "./config.ts";
import { accept, checkAccept, decide } from "./decisions.ts";
import { diffImages, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail, headSha, type BaselineSearch } from "./git.ts";
import { encodePng } from "./png.ts";
import { compareAsReviewed, findBaseline, readReviewCache, type Project } from "./project.ts";
import { isDecidable, summarizeRun } from "./summary.ts";

/** Each is about 20 KB of PNG. This is a reviewer going back and forth, not a cache of a run. */
const DIFFS_KEPT = 32;

const baselineNote = ({ sha, reason, message }: BaselineSearch) => ({ sha, reason, message });

const listing = ({ id, startedAt, status, dirty }: RunView["run"]) => ({ id, startedAt, status, dirty });

export function localReviewSource(project: Project, { native }: { readonly native?: boolean | undefined } = {}): ReviewSource {
  const { snapshots, store, repo } = project;

  /** A corrupt cache costs only pixel stats in a list, so it isn't worth failing a page over. */
  const cachedDiffs = async (runId: string): Promise<ReadonlyMap<string, PixelDiff>> => {
    const cache = await readReviewCache(project, runId).catch(() => null);
    return new Map(
      (cache?.differences ?? []).flatMap(({ story, pixelDiff }) => (pixelDiff === null ? [] : [[story, pixelDiff]])),
    );
  };

  const toRows = async (runId: string, compared: readonly ComparedSnapshot[]): Promise<SnapshotRow[]> => {
    const pixelDiffs = await cachedDiffs(runId);
    return compared.map((snapshot) => ({ ...snapshot, pixelDiff: pixelDiffs.get(snapshot.story) ?? null }));
  };

  const runView = async (runId: string): Promise<RunView> => {
    const { comparison, refusals, usableAsBaseline, removalFacts } = await checkAccept(project, { runId });
    const { run } = comparison;
    const summary = summarizeRun(comparison);
    const notRendered = new Set(summary.notRendered.map(({ story }) => story));
    // Why there's none is only known now, by asking Git: a run keeps only the answer it got.
    const baseline =
      run.baselineSha !== null
        ? { sha: run.baselineSha, reason: null, message: null }
        : baselineNote(await findBaseline(project, run.environment));
    return {
      run,
      baseline: { ...baseline, sha: run.baselineSha },
      acceptedRunId: await snapshots.acceptedRunAt(run.gitSha, run.environment),
      actor: await gitUserEmail(repo),
      blockers: summary.blockers,
      advisories: summary.advisories,
      counts: { ...summary.counts, failed: summary.failed.length },
      rows: await toRows(
        runId,
        comparison.snapshots.filter(({ story }) => !notRendered.has(story)),
      ),
      notRendered: [...notRendered],
      refusals,
      removals: removalFacts.stories,
      usableAsBaseline,
      siblings: (await snapshots.runsAt(run.gitSha, run.environment)).map(listing),
    };
  };

  /** Diffs by content, so any run that compares these two images shares the work. */
  const diffs = new Map<string, { diff: PixelDiff; png: Uint8Array | null }>();

  return {
    runView,

    async current(): Promise<CurrentView> {
      const { environmentId: environment } = await resolveCaptureSettings(repo, { native });
      const head = await headSha(repo);
      const runs = head === null ? [] : await snapshots.runsAt(head, environment);
      return {
        head,
        environment,
        runId: runs.find(({ status }) => status !== "recording")?.id ?? null,
        runs: runs.map(listing),
        baseline: baselineNote(await findBaseline(project, environment)),
      };
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
      const { snapshots: compared } = await compareAsReviewed(project, runId);
      const decidable = new Map(compared.filter(({ state }) => isDecidable(state)).map((row) => [row.story, row.imageHash]));
      const stale = targets.filter(({ story, imageHash }) => decidable.get(story) !== imageHash);
      if (stale.length > 0) {
        throw new SelfieError(
          "stale-decision",
          `${stale.length} of these images aren't what this run holds now, so nothing was decided. Look again.`,
        );
      }
      await decide(project, { runId, decision, actor, stories: { ids: targets.map(({ story }) => story) } });
      return runView(runId);
    },

    async accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome> {
      const { accepted, refusals } = await accept(project, { runId, removedSeen });
      return { accepted, refusals, view: await runView(runId) };
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
      const [currentImage, goldenImage] = await Promise.all([decodeImage(currentFile), decodeImage(goldenFile)]);
      const { diff, highlighted } = diffImages(currentImage, goldenImage);
      const result = { diff, png: highlighted === null ? null : await encodePng(highlighted) };
      diffs.set(key, result);
      for (const oldest of diffs.keys()) {
        if (diffs.size <= DIFFS_KEPT) break;
        diffs.delete(oldest);
      }
      return result;
    },
  };
}
