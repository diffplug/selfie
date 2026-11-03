import type { Meta, StoryObj } from "@storybook/react-vite";
import { rows } from "./stories/fixtures.ts";
import { BUTTON, NEIGHBORS, StoryPage, press } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/Comparing", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Changed: Story = { args: { row: BUTTON, others: NEIGHBORS } };
export const Stacked: Story = { args: { row: BUTTON }, play: press("f") };
export const StackedGolden: Story = { args: { row: BUTTON }, play: press("f", "f") };
export const StackedDiff: Story = { args: { row: BUTTON }, play: press("d") };
export const OneToOneZoom: Story = { args: { row: BUTTON }, play: press("z") };
export const EightTimesZoom: Story = { args: { row: BUTTON }, play: press("z", "z", "z", "z") };
export const TallPage: Story = { args: { row: rows.tall("pages-settings--account") } };
export const TallPageStacked: Story = { args: { row: rows.tall("pages-settings--account") }, play: press("f") };
export const RowAdded: Story = { args: { row: rows.taller("components-list--with-new-row") } };
export const RowAddedStacked: Story = { args: { row: rows.taller("components-list--with-new-row") }, play: press("f") };
export const RowRemoved: Story = { args: { row: rows.shorter("components-list--with-row-gone") } };
export const RowRemovedDiff: Story = { args: { row: rows.shorter("components-list--with-row-gone") }, play: press("d") };
export const RowAddedDiff: Story = { args: { row: rows.taller("components-list--with-new-row") }, play: press("d") };
export const SpacingOnly: Story = { args: { row: rows.spaced("pages-home--with-more-space") } };
export const SpacingOnlyDiff: Story = { args: { row: rows.spaced("pages-home--with-more-space") }, play: press("d") };
export const MovedOnly: Story = { args: { row: rows.moved("pages-home--indented") } };
export const MovedOnlyDiff: Story = { args: { row: rows.moved("pages-home--indented") }, play: press("d") };
export const ChangedMovedAndSpacingDiff: Story = { args: { row: rows.mixed("pages-home--redesigned") }, play: press("d") };
export const Shortcuts: Story = { args: { row: BUTTON }, play: press("?") };
export const Dark: Story = { args: { row: BUTTON }, parameters: { colorMode: "night" } };
