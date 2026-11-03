import { RelativeTime } from "@primer/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { anyStoryPath } from "./router.tsx";
import { StorySidebar } from "./StoryNav.tsx";
import { MIXED, rendered } from "./stories/everyStory.ts";

const STORIES = MIXED.stories;

function Tree({ width = 300, ...sidebar }: Partial<ComponentProps<typeof StorySidebar>> & { width?: number }) {
  return (
    <div style={{ width }}>
      <StorySidebar stories={STORIES} story={null} search="" hrefOf={anyStoryPath} emptyWords="No stories yet." {...sidebar} />
    </div>
  );
}

const meta = { title: "Parts/Story tree", component: Tree } satisfies Meta<typeof Tree>;
export default meta;
type Story = StoryObj<typeof meta>;

const when = ({ render }: (typeof STORIES)[number]) => render !== null && <RelativeTime date={new Date(render.renderedAt)} />;
const MOVED = rendered("widgets-button--primary", { state: "new" });

export const AsItStarts: Story = {};
export const OnAStory: Story = { args: { story: "components-button--primary" } };
export const AllOpen: Story = { args: { startOpen: true } };
export const Filtered: Story = { args: { search: "?q=button" } };
export const NothingMatches: Story = { args: { search: "?q=nothing-like-this" } };
export const Empty: Story = { args: { stories: [] } };
export const Renamed: Story = { args: { stories: [MOVED], renames: new Map([[MOVED.story, "components-button--primary"]]), startOpen: true } };
export const WideEnoughForStateAndDecision: Story = { args: { width: 600, startOpen: true } };
export const WideEnoughForEverything: Story = { args: { width: 900, startOpen: true, more: when } };
