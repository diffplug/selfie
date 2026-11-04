import type { Meta, StoryObj } from "@storybook/react-vite";
import { MIXED, rendering } from "./stories/everyStory.ts";
import { navigationIn, StoriesLayout, UnrenderedStory } from "./StoriesScreen.tsx";
import { approved, OTHER_BATCH_ID, rejected, rows, viewOf } from "./stories/fixtures.ts";
import { BUTTON, StoryPage, press } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/States", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NewStory: Story = { args: { row: rows.fresh("components-badge--new") } };
export const Removed: Story = { args: { row: rows.removed("components-legacy--old") } };
export const Failed: Story = { args: { row: rows.failed("components-dialog--open") } };
export const Approved: Story = { args: { row: rows.changed("components-button--primary", approved()) } };
export const Rejected: Story = { args: { row: rows.changed("components-button--primary", rejected("reviewer@example.com")) } };
export const PlayError: Story = {
  args: { row: rows.changed("components-tooltip--hover", { playError: "expected the tooltip to be visible" }) },
};
export const RenderedAtTwoTimes: Story = {
  args: {
    row: rows.double("components-button--primary"),
    view: viewOf([rows.double("components-button--primary")], { batch: { scale: 2 } }),
  },
  play: press("f"),
};
export const ReusedPixels: Story = {
  args: { row: BUTTON, view: viewOf([BUTTON], { batch: { reusedFromBatch: OTHER_BATCH_ID } }) },
};

const unrenderedStory = (canRender: boolean) => {
  const shown = canRender ? MIXED : { ...MIXED, canRender: false };
  const story = "pages-home--default";
  return (
    <StoriesLayout view={shown} story={story} search="">
      <UnrenderedStory view={shown} story={story} navigation={navigationIn(shown, story, "")} renders={rendering({ can: canRender })} onWriteNote={() => undefined} />
    </StoriesLayout>
  );
};
export const NotRendered: Story = { args: { row: BUTTON }, render: () => unrenderedStory(true) };
export const NotRenderedAndCantBe: Story = { args: { row: BUTTON }, render: () => unrenderedStory(false) };
