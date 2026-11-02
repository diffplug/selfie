import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { userEvent, within } from "storybook/test";
import type { RunView } from "../shared/api.ts";
import type { RunState } from "./hooks.ts";
import { RunScreen } from "./RunScreen.tsx";
import { approved, failure, OTHER_RUN_ID, rejected, rows, runOf, stateOf, viewOf } from "./stories/fixtures.ts";

interface Args {
  readonly view: RunView;
  readonly state?: Partial<RunState>;
  readonly search?: string;
}

function Screen({ view, state, search = "" }: Args) {
  const returningFrom = useRef<string | null>(null);
  return <RunScreen state={stateOf(view, state)} view={view} search={search} returningFrom={returningFrom} />;
}

const meta = { title: "Screens/Run", component: Screen } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const SOME_CHANGES = [
  rows.changed("components-button--primary"),
  rows.tall("pages-settings--account"),
  rows.taller("components-list--with-new-row"),
  rows.fresh("components-badge--new"),
];

export const NothingDiffers: Story = { args: { view: viewOf([], { unchanged: 541 }) } };
export const FirstRunAllNew: Story = {
  args: {
    view: viewOf(
      ["a--one", "a--two", "a--three", "b--one", "b--two"].map((story) => rows.fresh(story)),
      { unchanged: 0, run: { baselineSha: null } },
    ),
  },
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
export const RecordedDirty: Story = { args: { view: viewOf(SOME_CHANGES, { run: { dirty: true } }) } };
export const ReusedPixels: Story = { args: { view: viewOf(SOME_CHANGES, { run: { reusedFromRun: OTHER_RUN_ID } }) } };
export const Filtered: Story = {
  args: {
    view: viewOf(SOME_CHANGES, {
      run: { storyFilter: { patterns: ["components-*", "nope--*"], unmatched: ["nope--*"] } },
    }),
  },
};
export const FilteredList: Story = { args: { view: viewOf(SOME_CHANGES), search: "?show=changed&text=button" } };
export const NothingMatchesFilter: Story = { args: { view: viewOf(SOME_CHANGES), search: "?text=no-such-story" } };
export const NewerRunExists: Story = {
  args: {
    view: viewOf(SOME_CHANGES, {
      siblings: [
        { id: OTHER_RUN_ID, startedAt: runOf().startedAt + 3_600_000, status: "complete", dirty: false },
        { id: runOf().id, startedAt: runOf().startedAt, status: "complete", dirty: false },
      ],
    }),
  },
};
export const NoBaselineOffHistory: Story = {
  args: { view: viewOf(SOME_CHANGES, { run: { baselineSha: null }, usableAsBaseline: false }) },
};
export const AcceptedHere: Story = {
  args: {
    view: viewOf(
      [rows.changed("components-button--primary", approved())],
      { acceptedRunId: runOf().id },
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
export const ScaledRun: Story = {
  args: { view: viewOf([rows.double("components-button--primary")], { run: { scale: 2 } }) },
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
