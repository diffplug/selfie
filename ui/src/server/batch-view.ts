// Everything a screen shows about a batch, from a comparison and what a platform can say about it. It
// knows `selfie-store`'s core and nothing else, so a local server and a Worker show the same thing.
import { storyEntriesIn, summarizeBatch, type ApprovedSince, type SinceBase, type BuiltStorybooks, type ComparedRender, type Comparison, type RenderBatch, type RenderBatches, type StoryEntry } from "selfie-store";
import type { ApprovedSinceView, BatchView, PixelDiff, RenderRow, SinceBaseView, StorybookLink } from "../shared/api.ts";

/** A person looks at a few batches at a time. */
const KEPT_INDEXES_HELD = 8;

export interface BatchViewPlatform {
  readonly batches: RenderBatches;
  readonly storybooks: BuiltStorybooks;
  /** Where a batch's kept built Storybook can be opened, or null if it isn't kept or can't be. */
  keptStorybookUrl(batchId: string): Promise<string | null>;
  /** The Storybook to open a batch's stories in, which may not be the one that rendered it. */
  storybookFor(batchId: string): Promise<StorybookLink | null>;
  /** The pixel stats known already for a batch's stories, for showing in a list. */
  pixelDiffs(batchId: string): Promise<ReadonlyMap<string, PixelDiff>>;
  hunkMergeDistance(): Promise<number>;
}

export interface BatchViews {
  toRows(batchId: string, compared: Comparison["renders"]): Promise<RenderRow[]>;
  viewOf(comparison: Comparison, actor: string | null): Promise<BatchView>;
  approvedSinceView(approved: ApprovedSince): Promise<ApprovedSinceView>;
  sinceBaseView(since: SinceBase): Promise<SinceBaseView>;
  /** A kept built Storybook's stories, which never change, or nothing if it can't say. */
  storiesOfKept(hash: string): Promise<readonly StoryEntry[]>;
}

export function batchViews(platform: BatchViewPlatform): BatchViews {
  const { batches, storybooks } = platform;

  const keptIndexes = new Map<string, Promise<readonly StoryEntry[]>>();
  const storiesOfKept = (hash: string) => {
    let index = keptIndexes.get(hash);
    if (index === undefined) {
      index = storybooks.readFile(hash, "index.json").then(
        (bytes) => (bytes === null ? [] : (storyEntriesIn(JSON.parse(new TextDecoder().decode(bytes))) ?? [])),
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
    const kept = await Promise.all([batch.id, ...approvedIn].map((id) => storybooks.storybookOfBatch(id)));
    const entries = (await Promise.all(kept.map((hash) => (hash === null ? [] : storiesOfKept(hash))))).flat();
    const named = new Map<string, StoryEntry>();
    for (const entry of entries) if (stories.has(entry.id) && !named.has(entry.id)) named.set(entry.id, entry);
    return [...named.values()].map(({ id: story, title, name }) => ({ story, title, name }));
  };

  const rowsWith = async <Compared extends ComparedRender>(compared: readonly Compared[], pixelDiffs: ReadonlyMap<string, PixelDiff>) => {
    const references = new Map(
      await Promise.all(
        [...new Set(compared.flatMap(({ goldenBatchId }) => goldenBatchId ?? []))].map(
          async (id) => [id, { url: await platform.keptStorybookUrl(id), viewports: await batches.storyViewportsOf(id) }] as const,
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

  const toRows = async (batchId: string, compared: Comparison["renders"]): Promise<RenderRow[]> => rowsWith(compared, await platform.pixelDiffs(batchId));

  /** Everything recomputed from what deciding compares with, which the caller already has. */
  const viewOf = async (comparison: Comparison, actor: string | null): Promise<BatchView> => {
    const { batch } = comparison;
    const summary = summarizeBatch(comparison);
    const rows = await toRows(batch.id, summary.inFilter);
    const [storybook, storyViewports, hunkMergeDistance, storyNames, siblings] = await Promise.all([
      platform.storybookFor(batch.id),
      batches.storyViewportsOf(batch.id),
      platform.hunkMergeDistance(),
      storyNamesFor(batch, new Set(rows.flatMap(({ goldenBatchId }) => goldenBatchId ?? [])), new Set(rows.map(({ story }) => story))),
      batches.batchesAt(batch.gitSha, batch.environment),
    ]);
    return {
      batch,
      storybook,
      storyViewports,
      hunkMergeDistance,
      actor,
      blockers: summary.blockers,
      counts: { ...summary.counts, failed: summary.failed.length },
      rows,
      storyNames,
      outsideFilter: summary.notRendered.length,
      siblings: siblings.map(({ id, startedAt, status, dirty }) => ({ id, startedAt, status, dirty })),
    };
  };

  /** Never a batch's cached stats, which are by story, of what it was compared with when it was reviewed. */
  const approvedSinceView = async ({ base, renders }: ApprovedSince): Promise<ApprovedSinceView> => ({ base, rows: await rowsWith(renders, new Map()) });

  /** Never a batch's cached stats either, which are of what it's compared with against approvals. */
  const sinceBaseView = async ({ base, renders }: SinceBase): Promise<SinceBaseView> => ({ base, rows: await rowsWith(renders, new Map()) });

  return { toRows, viewOf, approvedSinceView, sinceBaseView, storiesOfKept };
}
