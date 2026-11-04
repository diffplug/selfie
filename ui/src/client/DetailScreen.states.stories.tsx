import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MIXED, rendering } from "./stories/everyStory.ts";
import { navigationIn, StoriesLayout, UnrenderedStory } from "./StoriesScreen.tsx";
import { approved, note, OTHER_BATCH_ID, rejected, rows, viewOf } from "./stories/fixtures.ts";
import { BUTTON, StoryPage, press, stackedImagesLoaded } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/States", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

const ADDED = rows.fresh("components-badge--new");
const REMOVED = rows.removed("components-legacy--old");

/** One image has nothing to compare it with, so nothing should offer to. */
const expectNoComparing = (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  expect(canvas.queryByLabelText("How to compare the images")).toBeNull();
  expect(canvas.queryByLabelText("Which image to show")).toBeNull();
  expect(canvas.queryByText("Side by side")).toBeNull();
  expect(canvas.queryByText("Stacked")).toBeNull();
};

export const AddedAtFit: Story = {
  args: { row: ADDED },
  play: async ({ canvasElement }) => {
    // Nothing here to flip, stack, or diff, so these change nothing, and zoom goes round to where it started.
    await press("f", "s", "d", "z", "z", "z", "z", "z", "z")();
    expectNoComparing(canvasElement);
    expect(canvasElement.querySelector(".selfie-pane figcaption")).toBeNull();
    expect(within(canvasElement).getByRole("button", { name: "Fit" })).toHaveAttribute("aria-pressed", "true");
  },
};
export const AddedZoomed: Story = {
  args: { row: ADDED },
  play: async ({ canvasElement }) => {
    await press("z", "z", "z")();
    await stackedImagesLoaded(canvasElement);
    expectNoComparing(canvasElement);
    expect(within(canvasElement).getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "true");
  },
};
export const AddedWithABoxOnIt: Story = {
  args: { row: ADDED, notes: [note(1, { story: ADDED.story, imageHash: ADDED.imageHash, box: { x: 32, y: 40, width: 160, height: 36 }, text: "Too quiet." })] },
  play: async ({ canvasElement }) => {
    await press("z")();
    await stackedImagesLoaded(canvasElement);
    expectNoComparing(canvasElement);
    expect(canvasElement.querySelector(".selfie-note-box")).not.toBeNull();
  },
};
export const AddedShortcuts: Story = { args: { row: ADDED }, play: press("?") };
export const Removed: Story = {
  args: { row: REMOVED },
  play: async ({ canvasElement }) => expectNoComparing(canvasElement),
};
export const Failed: Story = { args: { row: rows.failed("components-dialog--open") } };
export const FailedWithNoImage: Story = { args: { row: { ...rows.failed("components-dialog--open"), goldenHash: null } } };
export const Approved: Story = { args: { row: rows.changed("components-button--primary", approved()) } };
export const Rejected: Story = { args: { row: rows.changed("components-button--primary", rejected("reviewer@example.com")) } };
export const PlayError: Story = {
  args: { row: rows.playFailed("components-tooltip--hover") },
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
