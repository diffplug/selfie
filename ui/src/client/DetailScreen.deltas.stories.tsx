import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { RenderRow } from "../shared/api.ts";
import { deltaKeysOf } from "./deltas.ts";
import { useFetched } from "./hooks.ts";
import { rows } from "./stories/fixtures.ts";
import { press, StoryPage } from "./stories/storyPage.tsx";

/** A story with these of its hunks accepted, whose keys are what its images really hold. */
function Accepted({ row, hunks }: { readonly row: RenderRow; readonly hunks: readonly number[] }) {
  const { data: keys } = useFetched(row.story, () => deltaKeysOf(row));
  if (keys === null) return null;
  const accepted = new Set(hunks.flatMap((hunk) => keys[hunk] ?? []));
  return <StoryPage row={row} accepted={accepted} />;
}

const meta = { title: "Pages/Story/Deltas", component: Accepted } satisfies Meta<typeof Accepted>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Stacked or not, a redrawn golden is only there once it's been drawn and loaded. */
const drawn = async (canvasElement: HTMLElement) => {
  await within(canvasElement).findByText(/^Accepted deltas account for/);
  await waitFor(() => {
    const images = [...canvasElement.querySelectorAll<HTMLImageElement>('img[src^="blob:"]')];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image.naturalWidth).toBeGreaterThan(0);
  });
};

const SEVERAL = rows.several("pages-home--rearranged");
const TALLER = rows.taller("components-list--with-new-row");

export const PartlyAccepted: Story = { args: { row: SEVERAL, hunks: [0] }, play: async ({ canvasElement }) => drawn(canvasElement) };
export const AllAccepted: Story = {
  args: { row: SEVERAL, hunks: SEVERAL.pixelDiff!.hunks.map((_, index) => index) },
  play: async ({ canvasElement }) => drawn(canvasElement),
};
export const GrewAndAccepted: Story = { args: { row: TALLER, hunks: [0] }, play: async ({ canvasElement }) => drawn(canvasElement) };
export const DiffOfWhatsLeft: Story = {
  args: { row: SEVERAL, hunks: [0] },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    await press("d")();
  },
};
export const GoldenOnRecord: Story = {
  args: { row: SEVERAL, hunks: [0] },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show the golden on record" }));
    await expect(within(canvasElement).getByRole("button", { name: "Show with deltas" })).toBeVisible();
  },
};
