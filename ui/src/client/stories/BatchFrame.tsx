// A batch's page in a story as the app shows it, with its tree and top bar.
import type { ReactNode } from "react";
import type { BatchContext, BatchView } from "../../shared/api.ts";
import type { StoryNavigation } from "../filter.ts";
import type { BatchState } from "../hooks.ts";
import { BatchLayout, useBatchTree } from "../BatchLayout.tsx";
import { BASELINE_SHA, SHA } from "./fixtures.ts";

const CONTEXT: BatchContext = { head: SHA, branch: "topic", mergeBase: BASELINE_SHA, defaultBranch: "main" };

export function BatchFrame({ view, state, story = null, search = "", children }: { view: BatchView; state: BatchState; story?: string | null; search?: string; children: (navigation: StoryNavigation | null) => ReactNode }) {
  const tree = useBatchTree(view, state.unchanged, search, story);
  return (
    <BatchLayout view={view} tree={tree} story={story} search={search} context={CONTEXT}>
      {children(tree.navigation)}
    </BatchLayout>
  );
}
