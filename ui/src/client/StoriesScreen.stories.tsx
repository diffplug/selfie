import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RenderProgress, StoriesView } from "../shared/api.ts";
import { RequestError } from "./api.ts";
import type { RenderingState } from "./hooks.ts";
import { RenderingStatus, StoriesLayout, StoriesOverview } from "./StoriesScreen.tsx";
import { MIXED, rendered, rendering, setupOf, unrendered, view } from "./stories/everyStory.ts";

function StoriesScreen({ view: shown, search, renders, progress = null, now = 0 }: { view: StoriesView; search: string; renders: RenderingState; progress?: RenderProgress | null; now?: number }) {
  return (
    <StoriesLayout view={shown} story={null} search={search}>
      <RenderingStatus renders={renders} progress={progress} now={now} />
      <StoriesOverview view={shown} renders={renders} recheck={() => undefined} />
    </StoriesLayout>
  );
}

const screens = { title: "Pages/Every story", component: StoriesScreen } satisfies Meta<typeof StoriesScreen>;
export default screens;
type Story = StoryObj<typeof screens>;

const FAILED = new RequestError("render-failed", "That didn't render: Docker is unavailable.");

export const SomeRendered: Story = { args: { view: MIXED, search: "", renders: rendering() } };
const NOT_RENDERED = [unrendered("components-button--primary"), unrendered("components-button--secondary")];
const NOT_BUILT = { storybookUrl: null, canRender: false, newestBatchId: null, setup: setupOf({ storybookDir: "ui/storybook-static", buildCommand: "pnpm --filter ui build-storybook" }) };
export const NoCommits: Story = { args: { view: view([], { ...NOT_BUILT, head: null }), search: "", renders: rendering({ can: false }) } };
export const NoBuiltStorybook: Story = { args: { view: view([], NOT_BUILT), search: "", renders: rendering({ can: false }) } };
export const NoStories: Story = { args: { view: view([], { newestBatchId: null, canRender: false }), search: "", renders: rendering({ can: false }) } };
export const BuiltBeforeThisCommit: Story = { args: { view: view(NOT_RENDERED, { newestBatchId: null, setup: setupOf({ builtBeforeHead: true }) }), search: "", renders: rendering() } };
export const DetachedHead: Story = { args: { view: view(NOT_RENDERED, { newestBatchId: null, branch: null }), search: "", renders: rendering() } };
export const NothingRendered: Story = { args: { view: view(NOT_RENDERED, { newestBatchId: null }), search: "", renders: rendering() } };
export const NothingRenderedNatively: Story = { args: { view: view(NOT_RENDERED, { newestBatchId: null, setup: setupOf({ usesDocker: false }) }), search: "", renders: rendering() } };
export const NothingRenderedWithUncommittedChanges: Story = {
  args: { view: view(NOT_RENDERED, { newestBatchId: null, setup: setupOf({ uncommitted: ["src/Button.tsx", "src/Card.tsx", "storybook-static/", "README.md", "package.json"] }) }), search: "", renders: rendering() },
};
export const OnlyWhatsRendered: Story = { args: { view: view([rendered("components-card--default")], { storybookUrl: null, canRender: false, setup: null }), search: "", renders: rendering({ can: false }) } };
export const RenderingTheRest: Story = { args: { view: MIXED, search: "", renders: rendering({ rendering: 3 }) } };

// A render that took 10 seconds to get to its first story, at some moment since it was asked for.
const ASKED = 1_000_000;
const FIRST_STORY = ASKED + 10_000;
const renderingAll = (finished: number, firstStoryStartedAtMs: number | null, now: number): Story => ({
  args: { view: MIXED, search: "", renders: rendering({ rendering: 568 }), progress: { total: 568, finished, startedAtMs: ASKED, firstStoryStartedAtMs }, now },
});
export const RenderingBeforeTheFirstStory = renderingAll(0, null, ASKED + 4_000);
export const RenderingUnderThreeSeconds = renderingAll(6, FIRST_STORY, FIRST_STORY + 2_000);
export const RenderingWithNoStoryFinished = renderingAll(0, FIRST_STORY, FIRST_STORY + 20_000);
export const RenderingWithAnEstimate = renderingAll(120, FIRST_STORY, FIRST_STORY + 54_000);
export const RenderingAndSavingTheBatch = renderingAll(568, FIRST_STORY, FIRST_STORY + 251_000);
export const RenderFailed: Story = { args: { view: MIXED, search: "", renders: rendering({ error: FAILED }) } };
export const Dark: Story = { args: { view: MIXED, search: "", renders: rendering() }, parameters: { colorMode: "night" } };
