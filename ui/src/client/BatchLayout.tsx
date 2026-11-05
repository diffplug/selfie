// What every page of a batch sits in: the tree of what differs at the left, and the top bar saying what's compared.
import { useMemo, type ReactNode } from "react";
import type { BatchContext, BatchView, RenderRow } from "../shared/api.ts";
import { findRenames } from "../shared/renames.ts";
import { applyFilter, navigationThrough, NO_FILTER, parseFilter, rowsFor } from "./filter.ts";
import type { BatchState } from "./hooks.ts";
import { usePageFacts } from "./PageFacts.tsx";
import { batchPath, storyPath } from "./router.tsx";
import { matchingStories, StoryNavLayout } from "./StoryNav.tsx";
import { differingStories, inTreeOrder } from "./storyTree.ts";
import { describePixels } from "./words.tsx";

const NO_ROWS: readonly RenderRow[] = [];

/** The tree shows what the page's Show says, and its own search does the text. Next and previous go through just that. */
export function useBatchTree(view: BatchView | null, read: Pick<BatchState, "unchanged" | "approvedSince">, search: string, story: string | null) {
  const rows = view?.rows;
  const renames = useMemo(() => findRenames(rows ?? []), [rows]);
  const { show, text } = parseFilter(search);
  const source = rowsFor(show, rows ?? [], read) ?? NO_ROWS;
  const shownRows = useMemo(() => applyFilter(source, { ...NO_FILTER, show }), [source, show]);
  const stories = useMemo(() => (view === null ? [] : differingStories({ ...view, rows: shownRows }, renames)), [view, shownRows, renames]);
  const rowOf = useMemo(() => new Map(source.map((row) => [row.story, row])), [source]);
  const navigation = useMemo(() => {
    if (view === null || story === null) return null;
    const all = inTreeOrder(differingStories({ ...view, rows: source }, renames));
    return navigationThrough(all, matchingStories(inTreeOrder(stories), text), story, (name) => storyPath(view.batch.id, name, search), batchPath(view.batch.id, search));
  }, [view, source, renames, stories, text, story, search]);
  return { renames, stories, rowOf, navigation };
}

export function BatchLayout({
  view,
  tree: { stories, renames, rowOf },
  story,
  search,
  context,
  children,
}: {
  view: BatchView;
  tree: ReturnType<typeof useBatchTree>;
  story: string | null;
  search: string;
  context: BatchContext | null;
  children: ReactNode;
}) {
  usePageFacts({ kind: "diff", batch: view.batch, context });
  return (
    <StoryNavLayout
      stories={stories}
      story={story}
      search={search}
      hrefOf={(name, query) => storyPath(view.batch.id, name, query)}
      renames={renames}
      startOpen
      emptyWords="Nothing differs."
      more={({ story: name }) => {
        const row = rowOf.get(name);
        if (row === undefined) return null;
        return (
          <span className="selfie-nav-col" data-size="wide" title={describePixels(row.pixelDiff)}>
            {row.state !== "failed" ? describePixels(row.pixelDiff) : row.imageHash === null ? "No image" : "Failed"}
          </span>
        );
      }}
    >
      {children}
    </StoryNavLayout>
  );
}
