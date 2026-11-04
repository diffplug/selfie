import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import type { BatchView } from "../shared/api.ts";
import { BatchFrame } from "./stories/BatchFrame.tsx";
import { AcceptScreen } from "./AcceptScreen.tsx";
import { approved, OTHER_BATCH_ID, rejected, rows, batchOf, stateOf, viewOf } from "./stories/fixtures.ts";

function Screen({ view, state }: ComponentProps<typeof AcceptScreen>) {
  return <BatchFrame view={view} state={state}>{() => <AcceptScreen view={view} state={state} />}</BatchFrame>;
}

const meta = {
  title: "Pages/Accept",
  component: Screen,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const withView = (view: BatchView): Story => ({ args: { view, state: stateOf(view) } });

const APPROVED = rows.changed("components-button--primary", approved());

export const Ready = withView(viewOf([APPROVED]));
export const NothingChanged = withView(viewOf([], { unchanged: 541 }));
export const Unapproved = withView(
  viewOf([
    rows.changed("components-button--primary"),
    rows.fresh("components-badge--new", rejected("reviewer@example.com")),
    APPROVED,
  ]),
);
export const RecordedDirty = withView(viewOf([APPROVED], { batch: { dirty: true } }));
export const HasFailures = withView(viewOf([rows.failed("components-dialog--open"), APPROVED]));
export const RemovalsToAcknowledge = withView(viewOf([rows.removed("components-legacy--old"), rows.removed("components-legacy--older"), APPROVED]));
export const RemovalsOutsideFilter = withView(
  viewOf([rows.removed("components-legacy--old")], {
    batch: { storyFilter: { patterns: ["components-*"], unmatched: [] } },
    removals: { stories: ["components-legacy--old", "pages-home--default"], outsideFilter: 1 },
  }),
);
export const ReplacesAnotherBatch = withView(viewOf([APPROVED], { acceptedBatchId: OTHER_BATCH_ID }));
export const ReusedPixels = withView(viewOf([APPROVED], { batch: { reusedFromBatch: OTHER_BATCH_ID } }));
export const OffBaselineHistory = withView(viewOf([APPROVED], { usableAsBaseline: false }));
export const WithPlayErrors = withView(viewOf([rows.unchangedWithPlayError("components-menu--opens"), APPROVED]));
export const Accepted = withView(viewOf([APPROVED], { acceptedBatchId: batchOf().id }));
export const Dark: Story = { ...withView(viewOf([APPROVED])), parameters: { colorMode: "night" } };
