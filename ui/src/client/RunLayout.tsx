// What every page of a run sits in: the tree of what differs at the left, and the top bar saying what's compared.
import { useMemo, type ReactNode } from "react";
import type { RunContext, RunView, SnapshotRow } from "../shared/api.ts";
import { findRenames } from "../shared/renames.ts";
import { applyFilter, NO_FILTER, parseFilter } from "./filter.ts";
import { usePageFacts } from "./PageFacts.tsx";
import { storyPath } from "./router.tsx";
import { StoryNavLayout } from "./StoryNav.tsx";
import { differingStories, inTreeOrder } from "./storyTree.ts";
import { AdvisoryLabels, describePixels } from "./words.tsx";

/** The tree shows what the page's Show says, and its own search does the text. */
export function useRunTree(view: RunView | null, unchanged: readonly SnapshotRow[] | null, search: string) {
  const rows = view?.rows;
  const renames = useMemo(() => findRenames(rows ?? []), [rows]);
  const { show } = parseFilter(search);
  const shownRows = useMemo(() => applyFilter(show === "unchanged" ? (unchanged ?? []) : (rows ?? []), { ...NO_FILTER, show }), [show, unchanged, rows]);
  const stories = useMemo(() => (view === null ? [] : differingStories({ ...view, rows: shownRows }, renames, show === "unchanged")), [view, shownRows, renames, show]);
  const treeOrder = useMemo(() => inTreeOrder(stories).map(({ story }) => story), [stories]);
  const rowOf = useMemo(() => new Map(shownRows.map((row) => [row.story, row])), [shownRows]);
  return { renames, stories, treeOrder, rowOf };
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
