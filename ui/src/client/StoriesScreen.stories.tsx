import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { RequestError } from "./api.ts";
import type { RenderState } from "./hooks.ts";
import { RenderStatus, navigationIn, StoriesLayout, StoriesOverview, UnrenderedStory } from "./StoriesScreen.tsx";
import { approved, OTHER_RUN_ID, RUN_ID, SHA } from "./stories/fixtures.ts";

// The renderer fixes the clock, so a relative date always reads the same there.
const RENDERED_AT = Date.UTC(2026, 0, 15, 11);

/** What a sidebar would call a story with this ID, `components-button--primary`. */
const named = (story: string) => {
  const [path = "", name = ""] = story.split("--");
  const words = (text: string) => text.replace(/(^|-)(\w)/g, (_, gap: string, letter: string) => (gap === "" ? "" : " ") + letter.toUpperCase());
  return { title: path.split("-").map(words).join("/"), name: words(name) };
};

const rendered = (story: string, overrides: Partial<NonNullable<ListedStory["render"]>> = {}): ListedStory => ({
  story,
  ...named(story),
  render: { runId: RUN_ID, state: "unchanged", decision: null, renderedAt: RENDERED_AT, dirty: false, fromHostedBuild: true, ...overrides },
});
const unrendered = (story: string): ListedStory => ({ story, ...named(story), render: null });

const setupOf = (setup: Partial<NonNullable<StoriesView["setup"]>>): NonNullable<StoriesView["setup"]> => ({ storybookDir: "storybook-static", buildCommand: null, uncommitted: [], builtFrom: "clean", usesDocker: true, ...setup });

const view = (stories: readonly ListedStory[], overrides: Partial<StoriesView> = {}): StoriesView => ({
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

const MIXED = view([
  rendered("components-badge--new", { state: "new", runId: OTHER_RUN_ID, dirty: true }),
  rendered("components-button--primary", { state: "changed", decision: approved().decision }),
  rendered("components-card--default"),
  rendered("components-list--broken", { state: "failed" }),
  rendered("components-nav--open", { state: "changed", fromHostedBuild: false }),
  unrendered("pages-home--default"),
  unrendered("pages-settings--account"),
]);

function StoriesScreen({ view: shown, search, renders }: { view: StoriesView; search: string; renders: RenderState }) {
  return (
    <StoriesLayout view={shown} story={null} search={search}>
      <RenderStatus renders={renders} />
      <StoriesOverview view={shown} renders={renders} recheck={() => undefined} />
    </StoriesLayout>
  );
}

const screens = { title: "Screens/Every story", component: StoriesScreen } satisfies Meta<typeof StoriesScreen>;
export default screens;
type Story = StoryObj<typeof screens>;

const rendering = (overrides: Partial<RenderState> = {}): RenderState => ({ can: true, rendering: 0, error: null, clearError: () => undefined, render: async () => true, ...overrides });
const FAILED = new RequestError("render-failed", "That didn't render: Docker is unavailable.");

export const SomeRendered: Story = { args: { view: MIXED, search: "", renders: rendering() } };
export const Filtered: Story = { args: { view: MIXED, search: "?q=button", renders: rendering() } };
export const NothingMatches: Story = { args: { view: MIXED, search: "?q=nothing-like-this", renders: rendering() } };
const NOT_RENDERED = [unrendered("components-button--primary"), unrendered("components-button--secondary")];
const NOT_BUILT = { storybookUrl: null, canRender: false, newestRunId: null, setup: setupOf({ builtFrom: null }) };
export const SetupNoCommits: Story = { args: { view: view([], { ...NOT_BUILT, head: null }), search: "", renders: rendering({ can: false }) } };
export const SetupNoBuild: Story = { args: { view: view([], NOT_BUILT), search: "", renders: rendering({ can: false }) } };
export const SetupNoBuildWithItsCommand: Story = {
  args: { view: view([], { ...NOT_BUILT, setup: setupOf({ builtFrom: null, storybookDir: "ui/storybook-static", buildCommand: "pnpm --filter ui build-storybook" }) }), search: "", renders: rendering({ can: false }) },
};
export const SetupNoStories: Story = { args: { view: view([], { newestRunId: null, canRender: false }), search: "", renders: rendering({ can: false }) } };
export const BuiltBeforeThisCommit: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "before-head" }) }), search: "", renders: rendering() } };
export const DetachedHead: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, branch: null }), search: "", renders: rendering() } };
export const NothingRendered: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null }), search: "", renders: rendering() } };
export const NothingRenderedNatively: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ usesDocker: false }) }), search: "", renders: rendering() } };
export const NothingRenderedWithUncommittedChanges: Story = {
  args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "uncommitted", uncommitted: ["src/Button.tsx", "src/Card.tsx", "storybook-static/", "README.md", "package.json"] }) }), search: "", renders: rendering() },
};
export const NoBuild: Story = { args: { view: view([rendered("components-card--default")], { storybookUrl: null, canRender: false, setup: null }), search: "", renders: rendering({ can: false }) } };
export const RenderingTheRest: Story = { args: { view: MIXED, search: "", renders: rendering({ rendering: 3 }) } };
export const RenderFailed: Story = { args: { view: MIXED, search: "", renders: rendering({ error: FAILED }) } };
export const NotRendered: Story = {
  args: { view: MIXED, search: "", renders: rendering() },
  render: ({ view: shown, renders }) => (
    <StoriesLayout view={shown} story="pages-home--default" search="">
      <UnrenderedStory view={shown} story="pages-home--default" navigation={navigationIn(shown, "pages-home--default", "")} renders={renders} onWriteNote={() => undefined} />
    </StoriesLayout>
  ),
};
export const NotRenderedAndCantBe: Story = {
  args: { view: { ...MIXED, canRender: false }, search: "", renders: rendering({ can: false }) },
  render: ({ view: shown, renders }) => (
    <StoriesLayout view={shown} story="pages-home--default" search="">
      <UnrenderedStory view={shown} story="pages-home--default" navigation={navigationIn(shown, "pages-home--default", "")} renders={renders} onWriteNote={() => undefined} />
    </StoriesLayout>
  ),
};
