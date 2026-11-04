// The review UI's window on a local repository: the library, as the shape its routes want. It reads
// what's been recorded, records decisions on it, and renders only when a page asks it to render.
import { newestRenders, type Comparison, type DecisionKind, type PlacedDecision, type RenderBatch } from "selfie-store";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isBuiltStorybook } from "selfie-ui/local";
import { keptStorybookPath } from "selfie-ui/api";
import { storybookHash, readStoriesInOrder, readStoryIndex, storiesInIndex, type StoryEntry } from "selfie-render";
import type { DecisionTarget, FeedbackView, NewNote, ReviewSource, BatchView, RenderRow, StoriesView, StorybookLink, StorySetup } from "selfie-ui/app";
import { resolveRenderSettings, resolveHunkMergeDistance } from "./config.ts";
import { decide } from "./decisions.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { currentBranch, dirtyPaths, gitUserEmail, headMovedAt, headSha } from "./git.ts";
import { isOpenNote } from "selfie-ui/notes";
import { sentNotes, textForAgent } from "./notes.ts";
import { batchesAtHead, compareAsReviewed, reachableCommits, readReviewCache, requireBatch, type Project } from "./project.ts";
import { summarizeBatch } from "./summary.ts";

/** Each is about 20 KB of PNG. This is a reviewer going back and forth, not a cache of a batch. */
const DIFFS_KEPT = 32;

/** A person looks at a few batches at a time. */
const KEPT_INDEXES_HELD = 8;

/** Records a batch from a hosted Storybook, of just these stories, or of every one, and says which batch. */
export type RenderStories = (stories: readonly string[] | undefined) => Promise<string>;

export function localReviewSource(
  project: Project,
  { native, storybook }: { readonly native?: boolean | undefined; readonly storybook?: { readonly dir: string; readonly url: string; readonly renderStories?: RenderStories | undefined } | undefined } = {},
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

  /** What the batch's own Storybook calls its stories, then what the batches behind its approvals called those it no longer has. */
  const storyNamesFor = async (batch: RenderBatch, approvedIn: ReadonlySet<string>, stories: ReadonlySet<string>) => {
    const kept = await Promise.all([batch.id, ...approvedIn].map((id) => project.storybooks.keptStorybookOfBatch(id)));
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
    const references = new Map(
      await Promise.all(
        [...new Set(compared.flatMap(({ goldenBatchId }) => goldenBatchId ?? []))].map(
          async (id) => [id, { url: await keptStorybookUrl(id), viewports: await project.storybooks.storyViewportsOf(id) }] as const,
        ),
      ),
    );
    return compared.map((render) => {
      const reference = render.goldenBatchId === undefined ? undefined : references.get(render.goldenBatchId);
      return {
        ...render,
        pixelDiff: pixelDiffs.get(render.story) ?? null,
        goldenStorybookUrl: reference?.url ?? null,
        goldenViewport: reference?.viewports[render.story] ?? null,
      };
    });
  };

  /** Everything recomputed from what deciding compares with, which the caller already has. */
  const viewOf = async (comparison: Comparison, actor: string | null): Promise<BatchView> => {
    const { batch } = comparison;
    const summary = summarizeBatch(comparison);
    const rows = await toRows(batch.id, summary.inFilter);
    return {
      batch,
      storybook: await storybookFor(batch.id),
      viewport: await project.storybooks.viewportOf(batch.environment),
      storyViewports: await project.storybooks.storyViewportsOf(batch.id),
      hunkMergeDistance: await resolveHunkMergeDistance(repo),
      actor,
      blockers: summary.blockers,
      advisories: summary.advisories,
      counts: { ...summary.counts, failed: summary.failed.length },
      rows,
      storyNames: await storyNamesFor(batch, new Set(rows.flatMap(({ goldenBatchId }) => goldenBatchId ?? [])), new Set(rows.map(({ story }) => story))),
      outsideFilter: summary.notRendered.length,
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

      // Batches at one commit on one branch see the same decisions, and a filtered render at a time can make many batches.
      const decisions = new Map<string | null, Promise<readonly PlacedDecision[]>>();
      const rowsOf = async (batch: RenderBatch) => {
        if (!decisions.has(batch.branch)) decisions.set(batch.branch, reachableCommits(project, batch).then((commits) => project.batches.decisionsAt(batch.environment, commits)));
        return (await project.batches.compareFromHistory(batch.id, await decisions.get(batch.branch)!, { includeUnchanged: true })).renders;
      };
      const renders = await newestRenders(finished, rowsOf, index.length > 0 ? new Set(index.map(({ id }) => id)) : undefined);

      // Hashing a whole build isn't worth it until there's a render to compare it with.
      const hosted = built && renders.size > 0 ? await hostedStorybook(storybook.dir) : null;
      const storybooks = new Map<string, string | null>();
      const buildOf = async (batchId: string) => {
        if (!storybooks.has(batchId)) storybooks.set(batchId, await project.storybooks.storybookOfBatch(batchId));
        return storybooks.get(batchId)!;
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
        canRender: built && head !== null && storybook.renderStories !== undefined,
        setup:
          storybook === undefined
            ? null
            : {
                storybookDir: path.relative(repo.root, storybook.dir) || ".",
                buildCommand: settings.buildCommand,
                uncommitted: await dirtyPaths(repo),
                builtBeforeHead: built && head !== null && (await builtBeforeHead(storybook.dir)),
                usesDocker: settings.environment.runner.kind === "container",
              },
      };
    },

    async render(stories) {
      if (storybook === undefined || storybook.renderStories === undefined || !isBuiltStorybook(storybook.dir)) {
        throw new SelfieError("render-failed", "This server has no built Storybook to render a story from.");
      }
      if (rendering) throw new SelfieError("render-busy", "A render is already running here. Try again once it's done.");
      rendering = true;
      try {
        const index = new Set((await readStoryIndex(storybook.dir)).map(({ id }) => id));
        const unknown = stories.find((story) => !index.has(story));
        if (unknown !== undefined) throw new SelfieError("unknown-story", `The hosted Storybook has no story ${unknown}.`);
        // Every story is a whole batch, which can say what's been removed, and not a filtered one that can't.
        return { batchId: await storybook.renderStories(new Set(stories).size === index.size ? undefined : stories) };
      } catch (error) {
        if (error instanceof SelfieError && error.code === "unknown-story") throw error;
        throw new SelfieError("render-failed", `That didn't render: ${(error as Error).message}`);
      } finally {
        rendering = false;
      }
    },

    async batchContext(batchId) {
      await requireBatch(project, batchId);
      const [head, branch] = await Promise.all([headSha(repo), currentBranch(repo)]);
      return { head, branch };
    },

    async unchanged(batchId) {
      const { renders: compared } = await compareAsReviewed(project, batchId, { includeUnchanged: true });
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
