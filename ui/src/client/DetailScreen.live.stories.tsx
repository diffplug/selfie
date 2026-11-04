import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import type { BatchView, RenderRow } from "../shared/api.ts";
import { rows, viewOf } from "./stories/fixtures.ts";
import { BUTTON, StoryPage, press } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/Live", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithStorybook: Story = {
  args: { row: BUTTON, view: { ...viewOf([BUTTON]), storybook: { url: "http://127.0.0.1:51234/built-storybooks/abc/", exactStorybook: true } } },
};
export const WithStorybookOfAnotherBuild: Story = {
  args: { row: BUTTON, view: { ...viewOf([BUTTON]), storybook: { url: "http://127.0.0.1:51234/", exactStorybook: false } } },
};
const FRESH = rows.fresh("components-badge--new");
const liveView = (row: RenderRow, overrides: Partial<BatchView> = {}): BatchView => ({
  ...viewOf([row]),
  storybook: { url: "./live-story/current/", exactStorybook: true },
  goldenStorybookUrl: "./live-story/golden/",
  ...overrides,
});
const liveLoaded = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await press("l")();
  await waitFor(() => {
    const frames = within(canvasElement).getAllByTitle<HTMLIFrameElement>(/running/);
    for (const frame of frames) expect(frame.contentDocument?.body?.childElementCount).toBeGreaterThan(0);
  });
};
export const Open: Story = { args: { row: BUTTON, view: liveView(BUTTON) }, play: liveLoaded };
export const NewStory: Story = { args: { row: FRESH, view: liveView(FRESH) }, play: liveLoaded };
export const GoldenNotKept: Story = { args: { row: BUTTON, view: liveView(BUTTON, { goldenStorybookUrl: null }) }, play: liveLoaded };
/** Its story focuses itself as it loads, and the page's keys must still reach the page. */
export const KeepsTheKeyboard: Story = {
  args: { row: BUTTON, view: liveView(BUTTON, { storybook: { url: "./live-story/grabbing/", exactStorybook: true }, goldenStorybookUrl: null }) },
  play: async (context) => {
    await liveLoaded(context);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await waitFor(() => expect(document.activeElement?.tagName).not.toBe("IFRAME"));
    await press("l")();
    await waitFor(() => expect(within(context.canvasElement).queryByTitle(/running/)).toBeNull());
  },
};
export const SizeUnknown: Story = { args: { row: BUTTON, view: liveView(BUTTON, { viewport: null }) }, play: liveLoaded };
