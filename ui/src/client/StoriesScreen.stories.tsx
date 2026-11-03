import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ListedStory, StoriesView } from "../shared/api.ts";
import { RequestError } from "./api.ts";
import type { CaptureState } from "./hooks.ts";
import { CaptureStatus, navigationIn, StoriesScreen, UncapturedStory } from "./StoriesScreen.tsx";
import { approved, OTHER_RUN_ID, RUN_ID, SHA } from "./stories/fixtures.ts";

// The renderer fixes the clock, so a relative date always reads the same there.
const CAPTURED_AT = Date.UTC(2026, 0, 15, 11);

/** What a sidebar would call a story with this ID, `components-button--primary`. */
const named = (story: string) => {
  const [path = "", name = ""] = story.split("--");
  const words = (text: string) => text.replace(/(^|-)(\w)/g, (_, gap: string, letter: string) => (gap === "" ? "" : " ") + letter.toUpperCase());
  return { title: path.split("-").map(words).join("/"), name: words(name) };
};

const captured = (story: string, overrides: Partial<NonNullable<ListedStory["capture"]>> = {}): ListedStory => ({
  story,
  ...named(story),
  capture: { runId: RUN_ID, state: "unchanged", decision: null, capturedAt: CAPTURED_AT, dirty: false, fromHostedBuild: true, ...overrides },
});
const uncaptured = (story: string): ListedStory => ({ story, ...named(story), capture: null });

const setupOf = (setup: Partial<NonNullable<StoriesView["setup"]>>): NonNullable<StoriesView["setup"]> => ({ storybookDir: "storybook-static", buildCommand: null, uncommitted: [], builtFrom: "clean", usesDocker: true, ...setup });

const view = (stories: readonly ListedStory[], overrides: Partial<StoriesView> = {}): StoriesView => ({
  head: SHA,
  branch: "main",
  storybookUrl: "./live-story/current/",
  viewport: { width: 1200, height: 900 },
  stories,
  newestRunId: RUN_ID,
  canCapture: true,
  setup: setupOf({}),
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

const screens = { title: "Screens/Every story", component: StoriesScreen, args: { recheck: () => undefined } } satisfies Meta<typeof StoriesScreen>;
export default screens;
type Story = StoryObj<typeof screens>;

const capturing = (overrides: Partial<CaptureState> = {}): CaptureState => ({ can: true, capturing: 0, error: null, clearError: () => undefined, capture: async () => true, ...overrides });
const FAILED = new RequestError("capture-failed", "That didn't render: Docker is unavailable.");

export const SomeCaptured: Story = { args: { view: MIXED, search: "", capture: capturing() } };
export const Filtered: Story = { args: { view: MIXED, search: "?q=button", capture: capturing() } };
export const NothingMatches: Story = { args: { view: MIXED, search: "?q=nothing-like-this", capture: capturing() } };
const NOT_RENDERED = [uncaptured("components-button--primary"), uncaptured("components-button--secondary")];
const NOT_BUILT = { storybookUrl: null, canCapture: false, newestRunId: null, setup: setupOf({ builtFrom: null }) };
export const SetupNoCommits: Story = { args: { view: view([], { ...NOT_BUILT, head: null }), search: "", capture: capturing({ can: false }) } };
export const SetupNoBuild: Story = { args: { view: view([], NOT_BUILT), search: "", capture: capturing({ can: false }) } };
export const SetupNoBuildWithItsCommand: Story = {
  args: { view: view([], { ...NOT_BUILT, setup: setupOf({ builtFrom: null, storybookDir: "ui/storybook-static", buildCommand: "pnpm --filter ui build-storybook" }) }), search: "", capture: capturing({ can: false }) },
};
export const SetupNoStories: Story = { args: { view: view([], { newestRunId: null, canCapture: false }), search: "", capture: capturing({ can: false }) } };
export const BuiltBeforeThisCommit: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "before-head" }) }), search: "", capture: capturing() } };
export const DetachedHead: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, branch: null }), search: "", capture: capturing() } };
export const NothingCaptured: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null }), search: "", capture: capturing() } };
export const NothingCapturedNatively: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ usesDocker: false }) }), search: "", capture: capturing() } };
export const NothingCapturedWithUncommittedChanges: Story = {
  args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "uncommitted", uncommitted: ["src/Button.tsx", "src/Card.tsx", "storybook-static/", "README.md", "package.json"] }) }), search: "", capture: capturing() },
};
export const NoBuild: Story = { args: { view: view([captured("components-card--default")], { storybookUrl: null, canCapture: false, setup: null }), search: "", capture: capturing({ can: false }) } };
const withStatus = ({ view: shown, search, capture }: { view: StoriesView; search: string; capture: CaptureState }) => (
  <>
    <CaptureStatus capture={capture} />
    <StoriesScreen view={shown} search={search} capture={capture} recheck={() => undefined} />
  </>
);
export const CapturingTheRest: Story = { args: { view: MIXED, search: "", capture: capturing({ capturing: 3 }) }, render: withStatus };
export const CaptureFailed: Story = { args: { view: MIXED, search: "", capture: capturing({ error: FAILED }) }, render: withStatus };
export const NotCaptured: Story = {
  args: { view: MIXED, search: "", capture: capturing() },
  render: ({ view: shown, capture }) => <UncapturedStory view={shown} story="pages-home--default" navigation={navigationIn(shown, "pages-home--default", "")} capture={capture} onWriteNote={() => undefined} />,
};
export const NotCapturedAndCantBe: Story = {
  args: { view: { ...MIXED, canCapture: false }, search: "", capture: capturing({ can: false }) },
  render: ({ view: shown, capture }) => <UncapturedStory view={shown} story="pages-home--default" navigation={navigationIn(shown, "pages-home--default", "")} capture={capture} onWriteNote={() => undefined} />,
};
