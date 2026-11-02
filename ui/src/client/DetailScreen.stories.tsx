import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent } from "storybook/test";
import type { RunView, SnapshotRow } from "../shared/api.ts";
import { DetailScreen } from "./DetailScreen.tsx";
import { approved, OTHER_RUN_ID, rejected, rows, stateOf, viewOf } from "./stories/fixtures.ts";

interface Args {
  readonly row: SnapshotRow;
  readonly others?: readonly SnapshotRow[];
  readonly view?: RunView;
}

function Screen({ row, others = [], view }: Args) {
  const shown = view ?? viewOf([row, ...others]);
  return <DetailScreen state={stateOf(shown)} view={shown} story={row.story} search="" />;
}

const meta = { title: "Screens/Snapshot", component: Screen } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const press = (...keys: readonly string[]) => async () => {
  for (const key of keys) await userEvent.keyboard(key);
};

const BUTTON = rows.changed("components-button--primary");
const NEIGHBORS = [rows.fresh("components-badge--new"), rows.tall("pages-settings--account")];

export const Changed: Story = { args: { row: BUTTON, others: NEIGHBORS } };
export const Stacked: Story = { args: { row: BUTTON }, play: press("f") };
export const StackedGolden: Story = { args: { row: BUTTON }, play: press("f", "f") };
export const StackedDiff: Story = { args: { row: BUTTON }, play: press("d") };
export const OneToOneZoom: Story = { args: { row: BUTTON }, play: press("z") };
export const EightTimesZoom: Story = { args: { row: BUTTON }, play: press("z", "z", "z", "z") };
export const TallPage: Story = { args: { row: rows.tall("pages-settings--account") } };
export const TallPageStacked: Story = { args: { row: rows.tall("pages-settings--account") }, play: press("f") };
export const SizeDiffers: Story = { args: { row: rows.taller("components-list--with-new-row") } };
export const SizeDiffersStacked: Story = { args: { row: rows.taller("components-list--with-new-row") }, play: press("f") };
export const NewStory: Story = { args: { row: rows.fresh("components-badge--new") } };
export const Removed: Story = { args: { row: rows.removed("components-legacy--old") } };
export const Failed: Story = { args: { row: rows.failed("components-dialog--open") } };
export const Approved: Story = { args: { row: rows.changed("components-button--primary", approved()) } };
export const Rejected: Story = { args: { row: rows.changed("components-button--primary", rejected("reviewer@example.com")) } };
export const PlayError: Story = {
  args: { row: rows.changed("components-tooltip--hover", { playError: "expected the tooltip to be visible" }) },
};
export const CapturedAtTwoTimes: Story = {
  args: {
    row: rows.double("components-button--primary"),
    view: viewOf([rows.double("components-button--primary")], { run: { scale: 2 } }),
  },
  play: press("f"),
};
export const ReusedPixels: Story = {
  args: { row: BUTTON, view: viewOf([BUTTON], { run: { reusedFromRun: OTHER_RUN_ID } }) },
};
export const Shortcuts: Story = { args: { row: BUTTON }, play: press("?") };
export const Dark: Story = { args: { row: BUTTON }, parameters: { colorMode: "night" } };
