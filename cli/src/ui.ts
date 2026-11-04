// The review UI's window on a local repository: the library, as the shape its routes want. It reads
// what's been recorded, records decisions on it, and renders only when a page asks it to render.
import { newestRenders, type Comparison, type DecisionKind, type RenderBatch } from "selfie-store";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isBuiltStorybook } from "selfie-ui/local";
import { keptStorybookPath } from "selfie-ui/api";
import { storybookHash, readStoriesInOrder, readStoryIndex, storiesInIndex, type StoryEntry } from "selfie-render";
import type { AcceptOutcome, DecisionTarget, FeedbackView, NewNote, ReviewSource, BatchView, RenderRow, StoriesView, StorybookLink, StorySetup } from "selfie-ui/app";
import { resolveRenderSettings, resolveHunkMergeDistance } from "./config.ts";
import { accept, checkAccept, decide } from "./decisions.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { currentBranch, dirtyPaths, gitUserEmail, headMovedAt, headSha, type BaselineSearch } from "./git.ts";
import { isOpenNote } from "selfie-ui/notes";
import { sentNotes, textForAgent } from "./notes.ts";
import { branchGoldens, compareAsReviewed, compareAsShown, findBaseline, readReviewCache, requireBatch, batchesAtHead, type Project } from "./project.ts";
import { summarizeBatch } from "./summary.ts";

/** Each is about 20 KB of PNG. This is a reviewer going back and forth, not a cache of a batch. */
const DIFFS_KEPT = 32;

/** A person looks at a few batches at a time. */
const KEPT_INDEXES_HELD = 8;

const baselineNote = ({ sha, message }: BaselineSearch) => ({ sha, message });

/** Records a batch from a hosted Storybook, of just these stories, or of every one, and says which batch. */
export type StoryRenderer = (stories: readonly string[] | undefined) => Promise<string>;

export function localReviewSource(
  project: Project,
  { native, storybook }: { readonly native?: boolean | undefined; readonly storybook?: { readonly dir: string; readonly url: string; readonly render?: StoryRenderer | undefined } | undefined } = {},
): ReviewSource {
  const { batches, store, repo } = project;

  // One at a time from a page, since two can't both be what someone is waiting on. An agent's own
  // `selfie render` isn't held to this: each render has a directory of its own.
  let rendering = false;

  /** Hashing a whole built Storybook is too slow for every read of a page, and any change to it changes a file's time or size. */
  let knownStorybook: { readonly stamp: string; readonly hash: Promise<string | null> } | null = null;
  const hostedStorybook = async (dir: string): Promise<string | null> => {
    const files = (await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile());
    const stats = await Promise.all(files.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const { mtimeMs, size } = await stat(file).catch(() => ({ mtimeMs: 0, size: 0 }));
      return `${file}:${mtimeMs}:${size}`;
    }));
    const stamp = stats.sort().join();
    if (knownStorybook?.stamp !== stamp) knownStorybook = { stamp, hash: storybookHash(dir) };
    return knownStorybook.hash;
  };

  // Nothing says what a built Storybook was built from, since it may not have been built by Selfie. A built Storybook
  // newer than HEAD's last move can only have come from this commit or from changes made since.
  const builtBeforeHead = async (dir: string): Promise<boolean> => {
    const moved = await headMovedAt(repo);
    return moved !== null && (await stat(path.join(dir, "iframe.html"))).mtimeMs < moved;
  };

  const keptStorybookUrl = async (batchId: string): Promise<string | null> => {
    const kept = storybook === undefined ? null : await project.storybooks.keptStorybookOfBatch(batchId);
    return kept === null ? null : new URL(keptStorybookPath(kept), storybook!.url).href;
  };

  /** The very build that rendered a batch, if that's kept, or else the directory as it stands. */
  const storybookFor = async (batchId: string): Promise<StorybookLink | null> => {
    const kept = await keptStorybookUrl(batchId);
    if (kept !== null) return { url: kept, exactStorybook: true };
    return storybook !== undefined && isBuiltStorybook(storybook.dir) ? { url: storybook.url, exactStorybook: false } : null;
  };

  /** The kept built Storybook of the goldens a batch is compared with. Never the directory, which wouldn't be them. */
  const goldenStorybookFor = async ({ environment }: RenderBatch, sha: string | null): Promise<string | null> => {
    const goldens = sha === null ? null : await batches.acceptedBatchAt(sha, environment);
    return goldens === null ? null : keptStorybookUrl(goldens);
  };

  /** A kept built Storybook's stories, which never change, or nothing if it can't say. */
  const keptIndexes = new Map<string, Promise<readonly StoryEntry[]>>();
  const storiesOfKept = (hash: string) => {
    let index = keptIndexes.get(hash);
    if (index === undefined) {
      index = project.storybooks.readFile(hash, "index.json").then(
        (bytes) => (bytes === null ? [] : storiesInIndex(JSON.parse(new TextDecoder().decode(bytes)), "a kept index.json")),
      ).catch(() => []);
      keptIndexes.set(hash, index);
      for (const oldest of keptIndexes.keys()) {
        if (keptIndexes.size <= KEPT_INDEXES_HELD) break;
        keptIndexes.delete(oldest);
      }
    }
    return index;
  };

  /** What the batch's own Storybook calls its stories, then what its goldens' called those it no longer has. */
  const storyNamesFor = async (batch: RenderBatch, goldensSha: string | null, stories: ReadonlySet<string>) => {
    const goldens = goldensSha === null ? null : await batches.acceptedBatchAt(goldensSha, batch.environment);
    const kept = await Promise.all([batch.id, goldens].map((id) => (id === null ? null : project.storybooks.keptStorybookOfBatch(id))));
    const entries = (await Promise.all(kept.map((hash) => (hash === null ? [] : storiesOfKept(hash))))).flat();
    const named = new Map<string, StoryEntry>();
    for (const entry of entries) if (stories.has(entry.id) && !named.has(entry.id)) named.set(entry.id, entry);
    return [...named.values()].map(({ id: story, title, name }) => ({ story, title, name }));
  };

  /** A corrupt cache costs only pixel stats in a list, so it isn't worth failing a page over. */
  const cachedDiffs = async (batchId: string): Promise<ReadonlyMap<string, PixelDiff>> => {
    const cache = await readReviewCache(project, batchId).catch(() => null);
    return new Map(
      (cache?.differences ?? []).flatMap(({ story, pixelDiff }) => (pixelDiff === null ? [] : [[story, pixelDiff]])),
    );
  };

  const toRows = async (batchId: string, compared: Comparison["renders"]): Promise<RenderRow[]> => {
    const pixelDiffs = await cachedDiffs(batchId);
    return compared.map((render) => ({ ...render, pixelDiff: pixelDiffs.get(render.story) ?? null }));
  };

  /**
   * Everything recomputed from what deciding and accepting compare with, which the caller already
   * has, and which says what blocks. What it shows may be against the branch's goldens instead.
   */
  const viewOf = async (reviewed: Comparison, actor: string | null): Promise<BatchView> => {
    const { batch } = reviewed;
    const onBranch = await branchGoldens(project, batch);
    const comparison = onBranch === null ? reviewed : await batches.compareBatch(batch.id, onBranch);
    const summary = summarizeBatch(comparison);
    const checked = onBranch === null ? summary : summarizeBatch(reviewed);
    const notRendered = new Set(summary.notRendered.map(({ story }) => story));
    const { refusals, usableAsBaseline, removals } = await checkAccept(project, reviewed);
    const rows = await toRows(
      batch.id,
      comparison.renders.filter(({ story }) => !notRendered.has(story)),
    );
    return {
      batch,
      storybook: await storybookFor(batch.id),
      goldenStorybookUrl: await goldenStorybookFor(batch, onBranch ?? batch.baselineSha),
      viewport: await project.storybooks.viewportOf(batch.environment),
      branchGoldens: onBranch,
      hunkMergeDistance: await resolveHunkMergeDistance(repo),
      acceptedBatchId: await batches.acceptedBatchAt(batch.gitSha, batch.environment),
      actor,
      blockers: checked.blockers,
      advisories: summary.advisories,
      counts: { ...summary.counts, undecided: checked.counts.undecided, failed: summary.failed.length },
      rows,
      storyNames: await storyNamesFor(batch, onBranch ?? batch.baselineSha, new Set(rows.map(({ story }) => story))),
      refusals,
      removals,
      usableAsBaseline,
      siblings: (await batches.batchesAt(batch.gitSha, batch.environment)).map(({ id, startedAt, status, dirty }) => ({ id, startedAt, status, dirty })),
    };
  };

  /** Diffs by content, so any batch that compares these two images shares the work. */
  const diffs = new Map<string, Promise<{ diff: PixelDiff; png: Uint8Array } | null>>();

  const feedback = async (): Promise<FeedbackView> => ({
    folder: path.basename(repo.root),
    notes: await project.notes.list(),
    agentWaiting: await project.notes.isWaiting(),
    latestBatchId: await project.notes.latestBatch(),
  });

  const requireActor = async (consequence: string) => {
    const actor = await gitUserEmail(repo);
    if (actor === null) throw new SelfieError("no-actor", `Git doesn't say who you are, so ${consequence}. Set git config user.email.`);
    return actor;
  };

  return {
    feedback,

    async addNote(note: NewNote) {
      await requireBatch(project, note.batchId);
      await project.notes.add(note, await requireActor("this note wasn't saved"));
      return feedback();
    },

    async removeNote(id: number) {
      await project.notes.removeDraft(id);
      return feedback();
    },

    async answerNote(id: number, text: string, batchId: string) {
      await requireBatch(project, batchId);
      await project.notes.answer(id, text, await requireActor("this answer wasn't saved"), batchId);
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

    batchView: async (batchId) => viewOf(await compareAsReviewed(project, batchId), await gitUserEmail(repo)),

    async storiesView(): Promise<StoriesView> {
      const settings = await resolveRenderSettings(repo, { native });
      const { head, batches } = await batchesAtHead(project, settings.environmentId);
      const finished = batches.filter(({ status }) => status !== "recording");
      const built = storybook !== undefined && isBuiltStorybook(storybook.dir);
      const index = built ? await readStoriesInOrder(storybook.dir) : [];

      // Batches at one commit all find the same goldens on its branch, and finding them takes Git.
      let onBranch: Promise<string | null> | undefined;
      const rowsOf = async (batch: RenderBatch) => {
        const against = batch.baselineSha ?? (await (onBranch ??= branchGoldens(project, batch)));
        return (await compareAsShown(project, batch, against)).renders;
      };
      const renders = await newestRenders(finished, rowsOf, index.length > 0 ? new Set(index.map(({ id }) => id)) : undefined);

      // Hashing a whole build isn't worth it until there's a render to compare it with.
      const hosted = built && renders.size > 0 ? await hostedStorybook(storybook.dir) : null;
      const builds = new Map<string, string | null>();
      const buildOf = async (batchId: string) => {
        if (!builds.has(batchId)) builds.set(batchId, await project.storybooks.storybookOfBatch(batchId));
        return builds.get(batchId)!;
      };
      const listed = index.length > 0 ? index : [...renders.keys()].sort().map((id) => ({ id, title: "", name: id }));
      return {
        head,
        branch: await currentBranch(repo),
        storybookUrl: built ? storybook.url : null,
        viewport: settings.environment.viewport,
        stories: await Promise.all(
          listed.map(async ({ id: story, title, name }) => {
            const found = renders.get(story);
            if (found === undefined) return { story, title, name, render: null };
            const { batch, row } = found;
            const build = await buildOf(batch.id);
            return {
              story,
              title,
              name,
              render: {
                batchId: batch.id,
                state: row.state,
                decision: row.decision,
                renderedAt: batch.startedAt,
                dirty: batch.dirty,
                fromHostedStorybook: hosted === null || build === null ? null : build === hosted,
              },
            };
          }),
        ),
        newestBatchId: finished[0]?.id ?? null,
        canRender: built && head !== null && storybook.render !== undefined,
        setup:
          storybook === undefined
            ? null
            : {
                storybookDir: path.relative(repo.root, storybook.dir) || ".",
                buildCommand: settings.buildCommand ?? null,
                uncommitted: await dirtyPaths(repo),
                builtBeforeHead: built && head !== null && (await builtBeforeHead(storybook.dir)),
                usesDocker: settings.environment.runner.kind === "container",
              },
      };
    },

    async render(stories) {
      if (storybook === undefined || storybook.render === undefined || !isBuiltStorybook(storybook.dir)) {
        throw new SelfieError("render-failed", "This server has no built Storybook to render a story from.");
      }
      if (rendering) throw new SelfieError("render-busy", "A render is already running here. Try again once it's done.");
      rendering = true;
      try {
        const index = new Set((await readStoryIndex(storybook.dir)).map(({ id }) => id));
        const unknown = stories.find((story) => !index.has(story));
        if (unknown !== undefined) throw new SelfieError("unknown-story", `The hosted Storybook has no story ${unknown}.`);
        // Every story is a whole batch, which can become goldens, and not a filtered one that can't.
        return { batchId: await storybook.render(new Set(stories).size === index.size ? undefined : stories) };
      } catch (error) {
        if (error instanceof SelfieError && error.code === "unknown-story") throw error;
        throw new SelfieError("render-failed", `That didn't render: ${(error as Error).message}`);
      } finally {
        rendering = false;
      }
    },

    async baseline(batchId) {
      const batch = await requireBatch(project, batchId);
      return baselineNote(await findBaseline(project, batch.environment));
    },

    async batchContext(batchId) {
      const batch = await requireBatch(project, batchId);
      const [head, branch, { mergeBase, defaultBranch }] = await Promise.all([headSha(repo), currentBranch(repo), findBaseline(project, batch.environment)]);
      return { head, branch, mergeBase, defaultBranch };
    },

    async unchanged(batchId) {
      const batch = await requireBatch(project, batchId);
      const { renders: compared } = await compareAsShown(project, batch);
      return toRows(
        batchId,
        compared.filter(({ state }) => state === "unchanged"),
      );
    },

    async decide(batchId: string, decision: DecisionKind, targets: readonly DecisionTarget[]) {
      const actor = await requireActor("no decision was recorded");
      const { comparison } = await decide(project, { batchId, decision, actor, stories: { targets } });
      return viewOf(comparison, actor);
    },

    async accept(batchId: string, removedSeen: number | undefined): Promise<AcceptOutcome> {
      const { accepted, refusals, comparison } = await accept(project, { batchId, removedSeen });
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
