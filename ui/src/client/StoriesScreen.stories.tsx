import type { Meta, StoryObj } from "@storybook/react-vite";
import type { StoriesView } from "../shared/api.ts";
import { RequestError } from "./api.ts";
import type { RenderState } from "./hooks.ts";
import { RenderStatus, StoriesLayout, StoriesOverview } from "./StoriesScreen.tsx";
import { MIXED, rendered, rendering, setupOf, unrendered, view } from "./stories/everyStory.ts";

function StoriesScreen({ view: shown, search, renders }: { view: StoriesView; search: string; renders: RenderState }) {
  return (
    <StoriesLayout view={shown} story={null} search={search}>
      <RenderStatus renders={renders} />
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
const NOT_BUILT = { storybookUrl: null, canRender: false, newestRunId: null, setup: setupOf({ builtFrom: null }) };
export const NoCommits: Story = { args: { view: view([], { ...NOT_BUILT, head: null }), search: "", renders: rendering({ can: false }) } };
export const NoBuiltStorybook: Story = { args: { view: view([], NOT_BUILT), search: "", renders: rendering({ can: false }) } };
export const NoBuiltStorybookWithItsCommand: Story = {
  args: { view: view([], { ...NOT_BUILT, setup: setupOf({ builtFrom: null, storybookDir: "ui/storybook-static", buildCommand: "pnpm --filter ui build-storybook" }) }), search: "", renders: rendering({ can: false }) },
};
export const NoStories: Story = { args: { view: view([], { newestRunId: null, canRender: false }), search: "", renders: rendering({ can: false }) } };
export const BuiltBeforeThisCommit: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "before-head" }) }), search: "", renders: rendering() } };
export const DetachedHead: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, branch: null }), search: "", renders: rendering() } };
export const NothingRendered: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null }), search: "", renders: rendering() } };
export const NothingRenderedNatively: Story = { args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ usesDocker: false }) }), search: "", renders: rendering() } };
export const NothingRenderedWithUncommittedChanges: Story = {
  args: { view: view(NOT_RENDERED, { newestRunId: null, setup: setupOf({ builtFrom: "uncommitted", uncommitted: ["src/Button.tsx", "src/Card.tsx", "storybook-static/", "README.md", "package.json"] }) }), search: "", renders: rendering() },
};
export const OnlyWhatsRendered: Story = { args: { view: view([rendered("components-card--default")], { storybookUrl: null, canRender: false, setup: null }), search: "", renders: rendering({ can: false }) } };
export const RenderingTheRest: Story = { args: { view: MIXED, search: "", renders: rendering({ rendering: 3 }) } };
export const RenderFailed: Story = { args: { view: MIXED, search: "", renders: rendering({ error: FAILED }) } };
export const Dark: Story = { args: { view: MIXED, search: "", renders: rendering() }, parameters: { colorMode: "night" } };
