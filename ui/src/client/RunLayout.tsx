// What every page of a run sits in: the tree of what differs at the left, and the top bar saying what's compared.
import { useMemo, type ReactNode } from "react";
import type { RunContext, RunView, SnapshotRow } from "../shared/api.ts";
import { findRenames } from "../shared/renames.ts";
import { applyFilter, navigationThrough, NO_FILTER, parseFilter } from "./filter.ts";
import { usePageFacts } from "./PageFacts.tsx";
import { runPath, storyPath } from "./router.tsx";
import { matchingStories, StoryNavLayout } from "./StoryNav.tsx";
import { differingStories, inTreeOrder } from "./storyTree.ts";
import { AdvisoryLabels, describePixels } from "./words.tsx";

/** The tree shows what the page's Show says, and its own search does the text. Next and previous go through just that. */
export function useRunTree(view: RunView | null, unchanged: readonly SnapshotRow[] | null, search: string, story: string | null) {
  const rows = view?.rows;
  const renames = useMemo(() => findRenames(rows ?? []), [rows]);
  const { show, text } = parseFilter(search);
  const source = show === "unchanged" ? (unchanged ?? []) : (rows ?? []);
  const shownRows = useMemo(() => applyFilter(source, { ...NO_FILTER, show }), [source, show]);
  const stories = useMemo(() => (view === null ? [] : differingStories({ ...view, rows: shownRows }, renames)), [view, shownRows, renames]);
  const rowOf = useMemo(() => new Map(source.map((row) => [row.story, row])), [source]);
  const navigation = useMemo(() => {
    if (view === null || story === null) return null;
    const all = inTreeOrder(differingStories({ ...view, rows: source }, renames));
    return navigationThrough(all, matchingStories(inTreeOrder(stories), text), story, (name) => storyPath(view.run.id, name, search), runPath(view.run.id, search));
  }, [view, source, renames, stories, text, story, search]);
  return { renames, stories, rowOf, navigation };
}

export function RunLayout({
  view,
  tree: { stories, renames, rowOf },
  story,
  search,
  context,
  children,
}: {
  view: RunView;
  tree: ReturnType<typeof useRunTree>;
  story: string | null;
  search: string;
  context: RunContext | null;
  children: ReactNode;
}) {
  usePageFacts({ kind: "diff", run: view.run, branchGoldens: view.branchGoldens, context });
  return (
    <StoryNavLayout
      stories={stories}
      story={story}
      search={search}
      hrefOf={(name, query) => storyPath(view.run.id, name, query)}
      renames={renames}
      startOpen
      emptyWords="Nothing differs."
      more={({ story: name }) => {
        const row = rowOf.get(name);
        if (row === undefined) return null;
        return (
          <>
            <span className="selfie-nav-col" data-size="wide" title={describePixels(row.pixelDiff)}>
              {row.state === "failed" ? "No image" : describePixels(row.pixelDiff)}
            </span>
            <span className="selfie-nav-col">
              <AdvisoryLabels row={row} />
            </span>
          </>
        );
      }}
    >
      {children}
    </StoryNavLayout>
  );
}
