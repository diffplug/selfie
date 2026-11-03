import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { DetailScreen } from "./DetailScreen.tsx";
import { feedbackOf, rows, stateOf, viewOf } from "./stories/fixtures.ts";
import { RunFrame } from "./stories/RunFrame.tsx";
import { SEVERAL, StoryPage, press, stackedImagesLoaded } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/Regions", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RegionsSelected: Story = {
  args: { row: SEVERAL },
  play: async ({ canvasElement }) => {
    await press("x", "n", "n", "x")();
    await expect(within(canvasElement).getByText(/, 2 selected/)).toBeVisible();
  },
};
export const RegionsStackedOnTheSecond: Story = { args: { row: SEVERAL }, play: press("f", "n", "n") };
export const RegionsAllSelectedStacked: Story = {
  args: { row: SEVERAL },
  play: async ({ canvasElement }) => {
    await press("f", "x", "n", "x", "n", "x")();
    await expect(within(canvasElement).getByText(/, 3 selected/)).toBeVisible();
  },
};
export const RegionSelectedByItsOutline: Story = {
  args: { row: SEVERAL },
  play: async ({ canvasElement }) => {
    await press("f")();
    await stackedImagesLoaded(canvasElement);
    await userEvent.click(canvasElement.querySelector('.selfie-stack [data-region="1"]')!);
    await userEvent.click(canvasElement.querySelector('.selfie-stack [data-region="2"]')!);
    await expect(within(canvasElement).getByText(/, 2 selected/)).toBeVisible();
  },
};
/** More regions than the list has room for, all far enough apart to stay separate. */
const MANY_REGIONS = (() => {
  const row = rows.several("pages-home--with-many-changes");
  const regions = Array.from({ length: 14 }, (_, index) => {
    const box = { x: 40, y: 20 + index * 60, width: 200, height: 20 };
    return { current: box, golden: box, kind: "changed" as const, changedPixels: 4000, moved: [] };
  });
  return { ...row, pixelDiff: { ...row.pixelDiff!, regions } };
})();
/** Moves between two stories by a prop, as following a link does. */
function BetweenStories() {
  const other = rows.moved("pages-home--indented");
  const view = viewOf([SEVERAL, other]);
  const [story, setStory] = useState(SEVERAL.story);
  return (
    <>
      <button type="button" onClick={() => setStory(story === SEVERAL.story ? other.story : SEVERAL.story)}>
        Go to the other story
      </button>
      <RunFrame view={view} state={stateOf(view)} story={story}>
        {(treeOrder) => <DetailScreen state={stateOf(view)} view={view} story={story} search="" feedback={feedbackOf()} treeOrder={treeOrder} />}
      </RunFrame>
    </>
  );
}
export const SelectionForgottenOnLeaving: Story = {
  args: { row: SEVERAL },
  render: () => <BetweenStories />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await press("x")();
    await expect(canvas.getByText(/, 1 selected/)).toBeVisible();
    const leave = canvas.getByRole("button", { name: "Go to the other story" });
    await userEvent.click(leave);
    await expect(canvas.queryByText(/, \d selected/)).toBeNull();
    await userEvent.click(leave);
    await expect(canvas.queryByText(/, \d selected/)).toBeNull();
  },
};
export const ManyRegionsKeepTheFocusedOneInView: Story = {
  args: { row: MANY_REGIONS },
  play: async ({ canvasElement }) => {
    await press(...Array.from({ length: 12 }, () => "n"))();
    const focused = canvasElement.querySelector<HTMLElement>(".selfie-regions-list [data-focused]")!;
    const list = canvasElement.querySelector<HTMLElement>(".selfie-regions-list")!;
    await expect(list.scrollTop).toBeGreaterThan(0);
    await expect(focused.getBoundingClientRect().bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom + 1);
  },
};
export const RegionKeptStillOnFlip: Story = {
  args: { row: rows.pushed("pages-home--pushed-down") },
  play: async ({ canvasElement }) => {
    await press("f", "n", "n")();
    await stackedImagesLoaded(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".selfie-viewport")!;
    const before = viewport.scrollTop;
    await expect(before).toBeGreaterThan(30);
    await press("f")();
    // The button is 30 rows higher in the golden, so looking at it means scrolling up by that.
    await expect(viewport.scrollTop).toBe(before - 30);
  },
};
export const RegionNotHeldWithoutLookingAtOne: Story = {
  args: { row: rows.pushed("pages-home--pushed-down") },
  play: async ({ canvasElement }) => {
    await press("f")();
    await stackedImagesLoaded(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".selfie-viewport")!;
    const before = viewport.scrollTop;
    await expect(before).toBeGreaterThan(0);
    await press("f")();
    await expect(viewport.scrollTop).toBe(before);
  },
};
export const OutlinesOnTheGolden: Story = { args: { row: rows.mixed("pages-home--redesigned") }, play: press("f", "f") };
