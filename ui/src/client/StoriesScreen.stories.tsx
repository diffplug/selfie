import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { navigationIn, StoriesScreen, UncapturedStory } from "./StoriesScreen.tsx";
import { approved, OTHER_RUN_ID, RUN_ID, SHA } from "./stories/fixtures.ts";

// The renderer fixes the clock, so a relative date always reads the same there.
const CAPTURED_AT = Date.UTC(2026, 0, 15, 11);

const captured = (story: string, overrides: Partial<NonNullable<ListedStory["capture"]>> = {}): ListedStory => ({
  story,
  capture: { runId: RUN_ID, state: "unchanged", decision: null, capturedAt: CAPTURED_AT, dirty: false, fromHostedBuild: true, ...overrides },
});
const uncaptured = (story: string): ListedStory => ({ story, capture: null });

const view = (stories: readonly ListedStory[], overrides: Partial<StoriesView> = {}): StoriesView => ({
  head: SHA,
  storybookUrl: "./live-story/current/",
  viewport: { width: 1200, height: 900 },
  stories,
  newestRunId: RUN_ID,
  ...overrides,
});

const MIXED = view([
  captured("components-badge--new", { state: "new", runId: OTHER_RUN_ID, dirty: true }),
  captured("components-button--primary", { state: "changed", decision: approved().decision }),
  captured("components-card--default"),
  captured("components-list--broken", { state: "failed" }),
  captured("components-nav--open", { state: "changed", fromHostedBuild: false }),
  uncaptured("pages-home--default"),
  uncaptured("pages-settings--account"),
]);

const screens = { title: "Screens/Every story", component: StoriesScreen } satisfies Meta<typeof StoriesScreen>;
export default screens;
type Story = StoryObj<typeof screens>;

export const SomeCaptured: Story = { args: { view: MIXED, search: "" } };
export const Filtered: Story = { args: { view: MIXED, search: "?q=button" } };
export const NothingMatches: Story = { args: { view: MIXED, search: "?q=nothing-like-this" } };
export const NothingCaptured: Story = { args: { view: view([uncaptured("a--one"), uncaptured("a--two")], { newestRunId: null }), search: "" } };
export const NoBuild: Story = { args: { view: view([captured("components-card--default")], { storybookUrl: null }), search: "" } };
export const NotCaptured: Story = {
  args: { view: MIXED, search: "" },
  render: ({ view: shown }) => <UncapturedStory view={shown} story="pages-home--default" navigation={navigationIn(shown, "pages-home--default", "")} />,
};
