import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { userEvent, within } from "storybook/test";
import type { BatchView } from "../shared/api.ts";
import type { BatchState } from "./hooks.ts";
import { BatchFrame } from "./stories/BatchFrame.tsx";
import { BatchScreen } from "./BatchScreen.tsx";
import { approved, BASELINE_SHA, failure, OTHER_BATCH_ID, rejected, rows, batchOf, stateOf, viewOf } from "./stories/fixtures.ts";

interface Args {
  readonly view: BatchView;
  readonly state?: Partial<BatchState>;
  readonly search?: string;
}

function Screen({ view, state, search = "" }: Args) {
  const returningFrom = useRef<string | null>(null);
  const shown = stateOf(view, state);
  return (
    <BatchFrame view={view} state={shown} search={search}>
      {() => <BatchScreen state={shown} view={view} search={search} returningFrom={returningFrom} />}
    </BatchFrame>
  );
}

const meta = { title: "Pages/Batch", component: Screen } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const SOME_CHANGES = [
  rows.changed("components-button--primary"),
  rows.tall("pages-settings--account"),
  rows.taller("components-list--with-new-row"),
  rows.fresh("components-badge--new"),
];

export const NothingDiffers: Story = { args: { view: viewOf([], { unchanged: 541 }) } };
export const FirstBatchAllNew: Story = {
  args: {
    view: viewOf(
      ["a--one", "a--two", "a--three", "b--one", "b--two"].map((story) => rows.fresh(story)),
      { unchanged: 0, batch: { baselineSha: null } },
    ),
  },
};
export const MovedAndSpacingOnly: Story = {
  args: { view: viewOf([rows.spaced("pages-home--with-more-space"), rows.moved("pages-home--indented"), rows.changed("components-button--primary")]), search: "?show=layout" },
};
export const ChangesUndecided: Story = { args: { view: viewOf(SOME_CHANGES) } };
export const SomeDecided: Story = {
  args: {
    view: viewOf([
      rows.changed("components-button--primary", approved()),
      rows.tall("pages-settings--account", rejected("reviewer@example.com")),
      rows.taller("components-list--with-new-row"),
      rows.fresh("components-badge--new", approved("agent@example.com")),
    ]),
  },
};
export const FailedAndRemoved: Story = {
  args: {
    view: viewOf([
      rows.failed("components-dialog--open"),
      rows.changed("components-button--primary"),
      rows.removed("components-legacy--old"),
    ]),
  },
};
export const PlayErrors: Story = {
  args: {
    view: viewOf([
      rows.unchangedWithPlayError("components-menu--opens"),
      rows.changed("components-tooltip--hover", { playError: "expected the tooltip to be visible" }),
    ]),
  },
};
export const RecordedDirty: Story = { args: { view: viewOf(SOME_CHANGES, { batch: { dirty: true } }) } };
export const ReusedPixels: Story = { args: { view: viewOf(SOME_CHANGES, { batch: { reusedFromBatch: OTHER_BATCH_ID } }) } };
export const Filtered: Story = {
  args: {
    view: viewOf(SOME_CHANGES, {
      batch: { storyFilter: { patterns: ["components-*", "nope--*"], unmatched: ["nope--*"] } },
    }),
  },
};
export const ShowingOnlyWhatChanged: Story = { args: { view: viewOf(SOME_CHANGES), search: "?show=changed" } };
export const NewerBatchExists: Story = {
  args: {
    view: viewOf(SOME_CHANGES, {
      siblings: [
        { id: OTHER_BATCH_ID, startedAt: batchOf().startedAt + 3_600_000, status: "complete", dirty: false },
        { id: batchOf().id, startedAt: batchOf().startedAt, status: "complete", dirty: false },
      ],
    }),
  },
};
export const NoBaselineOffHistory: Story = {
  args: { view: viewOf(SOME_CHANGES, { batch: { baselineSha: null }, usableAsBaseline: false }) },
};
export const ComparedOnBranch: Story = {
  args: { view: viewOf(SOME_CHANGES, { batch: { baselineSha: null }, branchGoldens: BASELINE_SHA, usableAsBaseline: false }) },
};
export const AcceptedHere: Story = {
  args: {
    view: viewOf(
      [rows.changed("components-button--primary", approved())],
      { acceptedBatchId: batchOf().id },
    ),
  },
};
export const ActionFailed: Story = {
  args: {
    view: viewOf(SOME_CHANGES),
    state: { actionError: failure("stale-decision", "These images changed since this page read them, so nothing was decided.") },
  },
};
export const Dark: Story = { args: { view: viewOf(SOME_CHANGES) }, parameters: { colorMode: "night" } };
export const ScaledBatch: Story = {
  args: { view: viewOf([rows.double("components-button--primary")], { batch: { scale: 2 } }) },
};
export const ConfirmApproveAll: Story = {
  args: {
    view: viewOf([
      rows.changed("components-button--primary"),
      rows.fresh("components-badge--new", approved()),
      rows.tall("pages-settings--account", { playError: "expected a dialog to open" }),
    ]),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^Approve all/ }));
  },
};
