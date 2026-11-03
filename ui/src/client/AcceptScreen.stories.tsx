import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import type { RunView } from "../shared/api.ts";
import { RunFrame } from "./stories/RunFrame.tsx";
import { AcceptScreen } from "./AcceptScreen.tsx";
import { approved, OTHER_RUN_ID, rejected, rows, runOf, stateOf, viewOf } from "./stories/fixtures.ts";

function Screen({ view, state }: ComponentProps<typeof AcceptScreen>) {
  return <RunFrame view={view} state={state}>{() => <AcceptScreen view={view} state={state} />}</RunFrame>;
}

const meta = {
  title: "Pages/Accept",
  component: Screen,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const withView = (view: RunView): Story => ({ args: { view, state: stateOf(view) } });

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
export const RecordedDirty = withView(viewOf([APPROVED], { run: { dirty: true } }));
export const HasFailures = withView(viewOf([rows.failed("components-dialog--open"), APPROVED]));
export const RemovalsToAcknowledge = withView(viewOf([rows.removed("components-legacy--old"), rows.removed("components-legacy--older"), APPROVED]));
export const RemovalsOutsideFilter = withView(
  viewOf([rows.removed("components-legacy--old")], {
    run: { storyFilter: { patterns: ["components-*"], unmatched: [] } },
    removals: { stories: ["components-legacy--old", "pages-home--default"], outsideFilter: 1 },
  }),
);
export const ReplacesAnotherRun = withView(viewOf([APPROVED], { acceptedRunId: OTHER_RUN_ID }));
export const ReusedPixels = withView(viewOf([APPROVED], { run: { reusedFromRun: OTHER_RUN_ID } }));
export const OffBaselineHistory = withView(viewOf([APPROVED], { usableAsBaseline: false }));
export const WithPlayErrors = withView(viewOf([rows.unchangedWithPlayError("components-menu--opens"), APPROVED]));
export const Accepted = withView(viewOf([APPROVED], { acceptedRunId: runOf().id }));
export const Dark: Story = { ...withView(viewOf([APPROVED])), parameters: { colorMode: "night" } };
