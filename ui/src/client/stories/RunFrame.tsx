// A run's page in a story as the app shows it, with its tree and top bar.
import type { ReactNode } from "react";
import type { RunContext, RunView } from "../../shared/api.ts";
import type { StoryNavigation } from "../filter.ts";
import type { RunState } from "../hooks.ts";
import { RunLayout, useRunTree } from "../RunLayout.tsx";
import { BASELINE_SHA, SHA } from "./fixtures.ts";

const CONTEXT: RunContext = { head: SHA, branch: "topic", mergeBase: BASELINE_SHA, defaultBranch: "main" };

export function RunFrame({ view, state, story = null, search = "", children }: { view: RunView; state: RunState; story?: string | null; search?: string; children: (navigation: StoryNavigation | null) => ReactNode }) {
  const tree = useRunTree(view, state.unchanged, search, story);
  return (
    <RunLayout view={view} tree={tree} story={story} search={search} context={CONTEXT}>
      {children(tree.navigation)}
    </RunLayout>
  );
}
