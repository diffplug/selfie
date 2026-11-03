// The review UI's window on a local repository: the library, as the shape its routes want. It reads
// what's been recorded, records decisions on it, and renders only when a page asks it to capture.
import { newestCaptures, type Comparison, type DecisionKind, type Run } from "selfie-store";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isBuiltStorybook } from "selfie-ui/local";
import { keptBuildPath } from "selfie-ui/api";
import { buildHash, readStoriesInOrder, readStoryIndex } from "selfie-render";
import type { AcceptOutcome, DecisionTarget, FeedbackView, NewNote, ReviewSource, RunView, SnapshotRow, StoriesView, StorybookLink } from "selfie-ui/app";
import { resolveCaptureSettings, resolveRegionMergeDistance } from "./config.ts";
import { accept, checkAccept, decide } from "./decisions.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { dirtyPaths, gitUserEmail, type BaselineSearch } from "./git.ts";
import { isOpenNote } from "selfie-ui/notes";
import { sentNotes, textForAgent } from "./notes.ts";
import { branchGoldens, compareAsReviewed, compareAsShown, findBaseline, readReviewCache, requireRun, runsAtHead, type Project } from "./project.ts";
import { summarizeRun } from "./summary.ts";

/** Each is about 20 KB of PNG. This is a reviewer going back and forth, not a cache of a run. */
const DIFFS_KEPT = 32;

const baselineNote = ({ sha, message }: BaselineSearch) => ({ sha, message });

/** Records a run from a hosted Storybook, of just these stories, or of every one, and says which run. */
export type StoryRecorder = (stories: readonly string[] | undefined) => Promise<string>;

export function localReviewSource(
  project: Project,
  { native, storybook }: { readonly native?: boolean | undefined; readonly storybook?: { readonly dir: string; readonly url: string; readonly record?: StoryRecorder | undefined } | undefined } = {},
): ReviewSource {
  const { snapshots, store, repo } = project;

  // One at a time from a page, since two can't both be what someone is waiting on. An agent's own
  // `selfie record` isn't held to this: each capture has a directory of its own.
  let capturing = false;

  /** Hashing a whole build is too slow for every read of a page, and any change to it changes a file's time or size. */
  let knownBuild: { readonly stamp: string; readonly hash: Promise<string | null> } | null = null;
  const hostedBuild = async (dir: string): Promise<string | null> => {
    const files = (await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile());
    const stats = await Promise.all(files.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const { mtimeMs, size } = await stat(file).catch(() => ({ mtimeMs: 0, size: 0 }));
      return `${file}:${mtimeMs}:${size}`;
    }));
    const stamp = stats.sort().join();
    if (knownBuild?.stamp !== stamp) knownBuild = { stamp, hash: buildHash(dir) };
    return knownBuild.hash;
  };

  const keptStorybookUrl = async (runId: string): Promise<string | null> => {
    const kept = storybook === undefined ? null : await project.builds.keptBuildOfRun(runId);
    return kept === null ? null : new URL(keptBuildPath(kept), storybook!.url).href;
  };

  /** The very build that rendered a run, if that's kept, or else the directory as it stands. */
  const storybookFor = async (runId: string): Promise<StorybookLink | null> => {
    const kept = await keptStorybookUrl(runId);
    if (kept !== null) return { url: kept, exactBuild: true };
    return storybook !== undefined && isBuiltStorybook(storybook.dir) ? { url: storybook.url, exactBuild: false } : null;
  };

  /** The kept build of the goldens a run is compared with. Never the directory, which wouldn't be them. */
  const goldenStorybookFor = async ({ environment }: Run, sha: string | null): Promise<string | null> => {
    const goldens = sha === null ? null : await snapshots.acceptedRunAt(sha, environment);
    return goldens === null ? null : keptStorybookUrl(goldens);
  };

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
      storybook: await storybookFor(run.id),
      goldenStorybookUrl: await goldenStorybookFor(run, onBranch ?? run.baselineSha),
      viewport: await project.builds.viewportOf(run.environment),
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

  const feedback = async (): Promise<FeedbackView> => ({
    folder: path.basename(repo.root),
    notes: await project.notes.list(),
    agentWaiting: await project.notes.isWaiting(),
    latestRunId: await project.notes.latestRun(),
  });

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

    async answerNote(id: number, text: string, runId: string) {
      await requireRun(project, runId);
      await project.notes.answer(id, text, await requireActor("this answer wasn't saved"), runId);
      return feedback();
    },

    async resolveNote(id: number) {
      await project.notes.resolve(id);
      return feedback();
    },

    async sendNotes(via) {
      if (via === "agent" && !(await project.notes.isWaiting())) {
        throw new SelfieError("no-agent-waiting", "The agent stopped waiting, so nothing was sent. Copy these for an agent instead.");
      }
      await project.notes.send();
      // The person has what's been sent in hand now, so nobody is waiting for it.
      if (via === "copy") await project.notes.markDelivered();
      const view = await feedback();
      return { feedback: view, text: textForAgent(sentNotes(view.notes).filter(isOpenNote), view.folder) };
    },

    runView: async (runId) => viewOf(await compareAsReviewed(project, runId), await gitUserEmail(repo)),

    async storiesView(): Promise<StoriesView> {
      const settings = await resolveCaptureSettings(repo, { native });
      const { head, runs } = await runsAtHead(project, settings.environmentId);
      const finished = runs.filter(({ status }) => status !== "recording");
      const built = storybook !== undefined && isBuiltStorybook(storybook.dir);
      const index = built ? await readStoriesInOrder(storybook.dir) : [];
      const hosted = built ? await hostedBuild(storybook.dir) : null;

      // Runs at one commit all find the same goldens on its branch, and finding them takes Git.
      let onBranch: Promise<string | null> | undefined;
      const rowsOf = async (run: Run) => {
        const against = run.baselineSha ?? (await (onBranch ??= branchGoldens(project, run)));
        return (await compareAsShown(project, run, against)).snapshots;
      };
      const captures = await newestCaptures(finished, rowsOf, index.length > 0 ? new Set(index.map(({ id }) => id)) : undefined);

      const builds = new Map<string, string | null>();
      const buildOf = async (runId: string) => {
        if (!builds.has(runId)) builds.set(runId, await project.builds.buildOfRun(runId));
        return builds.get(runId)!;
      };
      const listed = index.length > 0 ? index : [...captures.keys()].sort().map((id) => ({ id, title: "", name: id }));
      return {
        head,
        storybookUrl: built ? storybook.url : null,
        viewport: settings.environment.viewport,
        stories: await Promise.all(
          listed.map(async ({ id: story, title, name }) => {
            const found = captures.get(story);
            if (found === undefined) return { story, title, name, capture: null };
            const { run, row } = found;
            const build = await buildOf(run.id);
            return {
              story,
              title,
              name,
              capture: {
                runId: run.id,
                state: row.state,
                decision: row.decision,
                capturedAt: run.startedAt,
                dirty: run.dirty,
                fromHostedBuild: hosted === null || build === null ? null : build === hosted,
              },
            };
          }),
        ),
        newestRunId: finished[0]?.id ?? null,
        canCapture: built && head !== null && storybook.record !== undefined,
        setup:
          storybook === undefined
            ? null
            : {
                storybookDir: path.relative(repo.root, storybook.dir) || ".",
                buildCommand: settings.buildCommand ?? null,
                uncommitted: await dirtyPaths(repo),
                usesDocker: settings.environment.runner.kind === "container",
              },
      };
    },

    async capture(stories) {
      if (storybook === undefined || storybook.record === undefined || !isBuiltStorybook(storybook.dir)) {
        throw new SelfieError("capture-failed", "This server has no built Storybook to capture.");
      }
      if (capturing) throw new SelfieError("capture-busy", "A capture is already running here. Try again once it's done.");
      capturing = true;
      try {
        const index = new Set((await readStoryIndex(storybook.dir)).map(({ id }) => id));
        const unknown = stories.find((story) => !index.has(story));
        if (unknown !== undefined) throw new SelfieError("unknown-story", `The hosted Storybook has no story ${unknown}.`);
        // Every story is a whole run, which can become goldens, and not a filtered one that can't.
        return { runId: await storybook.record(new Set(stories).size === index.size ? undefined : stories) };
      } catch (error) {
        if (error instanceof SelfieError && error.code === "unknown-story") throw error;
        throw new SelfieError("capture-failed", `That didn't capture: ${(error as Error).message}`);
      } finally {
        capturing = false;
      }
    },

    async baseline(runId) {
      const run = await requireRun(project, runId);
      return baselineNote(await findBaseline(project, run.environment));
    },

    async unchanged(runId) {
      const run = await requireRun(project, runId);
      const { snapshots: compared } = await compareAsShown(project, run);
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
