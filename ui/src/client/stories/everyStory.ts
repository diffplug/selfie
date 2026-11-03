// What the stories of the list of every story share.
import type { ListedStory, StoriesView } from "../../shared/api.ts";
import type { RenderingState } from "../hooks.ts";
import { nameFromId } from "../storyTree.ts";
import { approved, OTHER_RUN_ID, RUN_ID, SHA } from "./fixtures.ts";

// The renderer fixes the clock, so a relative date always reads the same there.
const RENDERED_AT = Date.UTC(2026, 0, 15, 11);

/** Nested, as a real Storybook's titles are. */
const named = (story: string) => {
  const { title, name } = nameFromId(story);
  return { title: title.replaceAll(" ", "/"), name };
};

export const rendered = (story: string, overrides: Partial<NonNullable<ListedStory["render"]>> = {}): ListedStory => ({
  story,
  ...named(story),
  render: { runId: RUN_ID, state: "unchanged", decision: null, renderedAt: RENDERED_AT, dirty: false, fromHostedStorybook: true, ...overrides },
});
export const unrendered = (story: string): ListedStory => ({ story, ...named(story), render: null });

export const setupOf = (setup: Partial<NonNullable<StoriesView["setup"]>>): NonNullable<StoriesView["setup"]> => ({ storybookDir: "storybook-static", buildCommand: null, uncommitted: [], builtBeforeHead: false, usesDocker: true, ...setup });

export const view = (stories: readonly ListedStory[], overrides: Partial<StoriesView> = {}): StoriesView => ({
  head: SHA,
  branch: "main",
  storybookUrl: "./live-story/current/",
  viewport: { width: 1200, height: 900 },
  stories,
  newestRunId: RUN_ID,
  canRender: true,
  setup: setupOf({}),
  ...overrides,
});

export const MIXED = view([
  rendered("components-badge--new", { state: "added", runId: OTHER_RUN_ID, dirty: true }),
  rendered("components-button--primary", { state: "changed", decision: approved().decision }),
  rendered("components-card--default"),
  rendered("components-list--broken", { state: "failed" }),
  rendered("components-nav--open", { state: "changed", fromHostedStorybook: false }),
  unrendered("pages-home--default"),
  unrendered("pages-settings--account"),
]);

export const rendering = (overrides: Partial<RenderingState> = {}): RenderingState => ({ can: true, rendering: 0, error: null, clearError: () => undefined, render: async () => true, ...overrides });
