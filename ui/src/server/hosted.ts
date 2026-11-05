// The review routes' window on a project in the cloud. It reads what's been pushed, and it can't render,
// decode an image, or ask Git, so it asks the store what a commit reaches, and is given diffs by whoever
// could work them out. See docs/specs/cloud.md.
import { exactRows, newestRenders, staleDecisionMessage, summarizeBatch, type BuiltStorybooks, type Comparison, type DecisionKind, type ReceivingStore, type RenderBatches, type RenderState, type StoredDiffs } from "selfie-store";
import { keptStorybookPath, type BatchView, type DecisionTarget, type FeedbackView, type ListedStory, type PixelDiff, type ReviewSource, type StoriesView } from "../shared/api.ts";
import { batchViews, type BatchViews } from "./batch-view.ts";

/** Nothing in the cloud reads a project's own config, so it groups hunks as a project does by default. */
const HUNK_MERGE_DISTANCE = 12;

export const refusal = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface HostedProject {
  readonly batches: RenderBatches;
  readonly storybooks: BuiltStorybooks;
  readonly store: ReceivingStore;
  readonly diffs: StoredDiffs;
  readonly name: string;
  readonly defaultBranch: string;
  /** Where this project's kept built Storybooks are, on an origin of their own, ending in no slash. */
  readonly storybookBase: string;
}

/** What a project's pages share from one request to the next, since kept built Storybooks never change. */
export function hostedViews(project: HostedProject): BatchViews {
  const { batches, storybooks } = project;
  const keptStorybookUrl = async (batchId: string) => {
    const kept = await storybooks.storybookOfBatch(batchId);
    return kept === null ? null : `${project.storybookBase}${keptStorybookPath(kept)}`;
  };
  return batchViews({
    batches,
    storybooks,
    keptStorybookUrl,
    storybookFor: async (batchId) => {
      const url = await keptStorybookUrl(batchId);
      return url === null ? null : { url, exactStorybook: true };
    },
    pixelDiffs: async () => new Map<string, PixelDiff>(),
    hunkMergeDistance: async () => HUNK_MERGE_DISTANCE,
  });
}

export function hostedReviewSource(
  project: HostedProject,
  views: BatchViews,
  { actor, decided }: { readonly actor: string | null; readonly decided: (comparison: Comparison) => Promise<void> },
): ReviewSource {
  const { batches, storybooks, store, diffs } = project;

  const notHere = (): never => {
    throw refusal("read-only", "Notes and rendering are only in selfie ui, on your own machine.");
  };
  const feedback = async (): Promise<FeedbackView> => ({ folder: project.name, notes: [], agentWaiting: false, latestBatchId: null });

  return {
    batchView: async (batchId): Promise<BatchView> => views.viewOf(await batches.compareReached(batchId), actor),
    async batchContext(batchId) {
      const batch = await batches.getBatch(batchId);
      if (batch === null) throw refusal("unknown-batch", `No batch ${batchId}.`);
      // There's no checkout here for a batch to be behind.
      return { head: batch.gitSha, branch: batch.branch };
    },
    async unchanged(batchId) {
      const { renders } = await batches.compareReached(batchId, { includeUnchanged: true });
      return views.toRows(batchId, renders.filter(({ state }) => state === "unchanged"));
    },
    async decide(batchId: string, decision: DecisionKind, targets: readonly DecisionTarget[]) {
      if (actor === null) throw refusal("not-signed-in", "Sign in to approve or reject.");
      const before = await batches.compareReached(batchId);
      const { stale } = exactRows(summarizeBatch(before).inFilter, targets);
      if (stale > 0) throw refusal("stale-decision", staleDecisionMessage(stale));
      const { batch } = before;
      await batches.decide({ environment: batch.environment, decision, actor, renders: targets, on: { batchId, gitSha: batch.gitSha } });
      const after = await batches.compareReached(batchId);
      await decided(after);
      return views.viewOf(after, actor);
    },
    async storiesView(): Promise<StoriesView> {
      const batch = (await batches.newestFinished(project.defaultBranch)) ?? (await batches.newestFinished());
      if (batch === null) return { head: null, branch: project.defaultBranch, storybookUrl: null, viewport: { width: 1200, height: 900 }, stories: [], newestBatchId: null, canRender: false, setup: null };
      const { renders } = await batches.compareReached(batch.id, { includeUnchanged: true });
      const found = await newestRenders([batch], async () => renders);
      const kept = await storybooks.storybookOfBatch(batch.id);
      const index = kept === null ? [] : await views.storiesOfKept(kept);
      const listed = index.length > 0 ? index : [...found.keys()].sort().map((id) => ({ id, title: "", name: id }));
      const stories: ListedStory[] = listed.map(({ id: story, title, name }) => {
        const render = found.get(story);
        return {
          story,
          title,
          name,
          render: render === undefined ? null : { batchId: batch.id, state: render.row.state as RenderState, decision: render.row.decision, renderedAt: batch.startedAt, dirty: batch.dirty, fromHostedStorybook: kept === null ? null : true },
        };
      });
      return { head: batch.gitSha, branch: batch.branch, storybookUrl: kept === null ? null : `${project.storybookBase}${keptStorybookPath(kept)}`, viewport: batch.viewport, stories, newestBatchId: batch.id, canRender: false, setup: null };
    },
    render: async () => notHere(),
    renderProgress: async () => null,
    feedback,
    addNote: async () => notHere(),
    removeNote: async () => notHere(),
    answerNote: async () => notHere(),
    resolveNote: async () => notHere(),
    sendNotes: async () => notHere(),
    image: (hash) => store.getImage(hash),
    async diffStats(current, golden) {
      const stats = await diffs.stats(current, golden);
      return stats === null ? null : (JSON.parse(stats) as PixelDiff);
    },
    diffImage: (current, golden) => diffs.image(current, golden),
  };
}
