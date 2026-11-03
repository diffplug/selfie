// The review UI's window on a local repository: the library, as the shape its routes want. Nothing
// here renders, so the UI only reads what `selfie review` recorded and records decisions on it.
import type { Comparison, DecisionKind } from "selfie-store";
import type { AcceptOutcome, CurrentView, DecisionTarget, FeedbackView, NewNote, ReviewSource, RunView, SnapshotRow } from "selfie-ui/app";
import path from "node:path";
import { resolveCaptureSettings, resolveRegionMergeDistance } from "./config.ts";
import { accept, checkAccept, decide } from "./decisions.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { gitUserEmail, type BaselineSearch } from "./git.ts";
import { sentNotes, textForAgent } from "./notes.ts";
import { branchGoldens, compareAsReviewed, findBaseline, readReviewCache, requireRun, runsAtHead, type Project } from "./project.ts";
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

  /**
   * Everything recomputed from what deciding and accepting compare with, which the caller already
   * has, and which says what blocks. What it shows may be against the branch's goldens instead.
   */
  const viewOf = async (reviewed: Comparison, actor: string | null): Promise<RunView> => {
    const { run } = reviewed;
    const onBranch = await branchGoldens(project, run);
    const comparison = onBranch === null ? reviewed : await snapshots.compareRun(run.id, onBranch);
    const summary = summarizeRun(comparison);
    const checked = onBranch === null ? summary : summarizeRun(reviewed);
    const notRendered = new Set(summary.notRendered.map(({ story }) => story));
    const { refusals, usableAsBaseline, removals } = await checkAccept(project, reviewed);
    return {
      run,
      branchGoldens: onBranch,
      regionMergeDistance: await resolveRegionMergeDistance(repo),
      acceptedRunId: await snapshots.acceptedRunAt(run.gitSha, run.environment),
      actor,
      blockers: checked.blockers,
      advisories: summary.advisories,
      counts: { ...summary.counts, undecided: checked.counts.undecided, failed: summary.failed.length },
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
  const diffs = new Map<string, Promise<{ diff: PixelDiff; png: Uint8Array } | null>>();

  const feedback = async (): Promise<FeedbackView> => ({ folder: path.basename(repo.root), notes: await project.notes.list() });

  const requireActor = async (consequence: string) => {
    const actor = await gitUserEmail(repo);
    if (actor === null) throw new SelfieError("no-actor", `Git doesn't say who you are, so ${consequence}. Set git config user.email.`);
    return actor;
  };

  return {
    feedback,

    async addNote(note: NewNote) {
      await requireRun(project, note.runId);
      await project.notes.add(note, await requireActor("this note wasn't saved"));
      return feedback();
    },

    async removeNote(id: number) {
      await project.notes.removeDraft(id);
      return feedback();
    },

    async sendNotes() {
      await project.notes.send();
      const view = await feedback();
      return { feedback: view, text: textForAgent(sentNotes(view.notes), view.folder) };
    },

    runView: async (runId) => viewOf(await compareAsReviewed(project, runId), await gitUserEmail(repo)),

    async current(): Promise<CurrentView> {
      const { environmentId: environment } = await resolveCaptureSettings(repo, { native });
      const { head, runs } = await runsAtHead(project, environment);
      const runId = runs.find(({ status }) => status !== "recording")?.id ?? null;
      return {
        head,
        runId,
        hasUnfinishedRun: runs.length > 0,
        baseline: runId === null ? baselineNote(await findBaseline(project, environment)) : null,
      };
    },

    async baseline(runId) {
      const run = await requireRun(project, runId);
      return baselineNote(await findBaseline(project, run.environment));
    },

    async unchanged(runId) {
      const run = await requireRun(project, runId);
      const { snapshots: compared } = await snapshots.compareRun(runId, (await branchGoldens(project, run)) ?? run.baselineSha, { includeUnchanged: true });
      return toRows(
        runId,
        compared.filter(({ state }) => state === "unchanged"),
      );
    },

    async decide(runId: string, decision: DecisionKind, targets: readonly DecisionTarget[]) {
      const actor = await requireActor("no decision was recorded");
      const { comparison } = await decide(project, { runId, decision, actor, stories: { targets } });
      return viewOf(comparison, actor);
    },

    async accept(runId: string, removedSeen: number | undefined): Promise<AcceptOutcome> {
      const { accepted, refusals, comparison } = await accept(project, { runId, removedSeen });
      return { accepted, refusals, view: await viewOf(comparison, await gitUserEmail(repo)) };
    },

    image: (hash) => store.getImage(hash),

    diff(current, golden) {
      const key = `${current}/${golden}`;
      const known = diffs.get(key);
      if (known !== undefined) {
        // Newest last, so the oldest is the one to drop.
        diffs.delete(key);
        diffs.set(key, known);
        return known;
      }
      // Kept while it's working too, since a page asks for a diff's stats and its image at once.
      const working = (async () => {
        const [currentImage, goldenImage] = await Promise.all([store.getPixels(current), store.getPixels(golden)]);
        return currentImage === null || goldenImage === null ? null : diffToPng(currentImage, goldenImage);
      })();
      diffs.set(key, working);
      for (const oldest of diffs.keys()) {
        if (diffs.size <= DIFFS_KEPT) break;
        diffs.delete(oldest);
      }
      const forget = () => void diffs.delete(key);
      working.then((result) => {
        if (result === null) forget();
      }, forget);
      return working;
    },
  };
}
