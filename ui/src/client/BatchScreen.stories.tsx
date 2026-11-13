import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { BatchView } from "../shared/api.ts";
import type { BatchState } from "./hooks.ts";
import { BatchFrame } from "./stories/BatchFrame.tsx";
import { BatchScreen } from "./BatchScreen.tsx";
import type { DeltaState } from "./deltas.ts";
import { approved, deltaFrom, deltasOf, failure, OTHER_BATCH_ID, rejected, rows, batchOf, stateOf, viewOf } from "./stories/fixtures.ts";

interface Args {
  readonly view: BatchView;
  readonly state?: Partial<BatchState>;
  readonly search?: string;
  readonly deltas?: DeltaState;
}

function Screen({ view, state, search = "", deltas = deltasOf() }: Args) {
  const returningFrom = useRef<string | null>(null);
  const shown = stateOf(view, state);
  return (
    <BatchFrame view={view} state={shown} search={search}>
      {() => <BatchScreen state={shown} view={view} search={search} returningFrom={returningFrom} deltas={deltas} />}
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
      { unchanged: 0 },
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
      rows.playFailed("components-menu--opens"),
      rows.playFailed("components-tooltip--hover"),
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
      rows.tall("pages-settings--account"),
    ]),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^Approve all/ }));
  },
};

const AFFECTED = ["components-button--primary", "pages-settings--account", "components-list--with-new-row"];
const OFFERS = [deltaFrom("taller-golden", [...AFFECTED, "pages-home--rearranged"]), deltaFrom("changed-golden", AFFECTED), deltaFrom("spaced-golden", AFFECTED)];
const APPROVED_EARLIER = { base: batchOf({ id: OTHER_BATCH_ID, branch: "main" }), rows: [{ ...rows.changed("components-button--primary", approved()), approvedIn: OTHER_BATCH_ID }, { ...rows.fresh("pages-home--new", approved()), approvedIn: OTHER_BATCH_ID }] };
export const ChangesApprovedEarlier: Story = { args: { view: viewOf([]), state: { approvedSince: APPROVED_EARLIER } } };
export const ChangesApprovedEarlierListed: Story = { args: { view: viewOf([]), state: { approvedSince: APPROVED_EARLIER }, search: "?show=approved-earlier" } };
export const LookingForRepeatedChanges: Story = { args: { view: viewOf(SOME_CHANGES), deltas: deltasOf({ progress: 40 }) } };
export const RepeatedChanges: Story = { args: { view: viewOf(SOME_CHANGES), deltas: deltasOf({ offers: OFFERS }) } };
export const LookingThroughADelta: Story = {
  args: { view: viewOf(SOME_CHANGES), deltas: deltasOf({ offers: OFFERS }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "Look through 3 snapshots" })[0]!);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Next" }));
    await expect(within(canvasElement).getByText("2 of 3")).toBeVisible();
  },
};
export const ConfirmAcceptingADelta: Story = {
  args: { view: viewOf(SOME_CHANGES), deltas: deltasOf({ offers: OFFERS, finishes: () => [rows.changed(AFFECTED[0]!), rows.changed(AFFECTED[1]!)] }) },
  play: async ({ canvasElement }) => {
    const [first] = within(canvasElement).getAllByRole("button", { name: "Accept this delta to all affected snapshots" });
    await userEvent.click(first!);
  },
};
export const AcceptedDeltas: Story = {
  args: { view: viewOf(SOME_CHANGES), deltas: deltasOf({ offers: OFFERS.slice(1), taken: OFFERS.slice(0, 1) }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText(/1 delta accepted in this browser/));
  },
};

// The base has its own changes nobody approved, which every branch from it inherits.
const BASE = batchOf({ id: OTHER_BATCH_ID, branch: "main", gitSha: "157c71787d1b9f2a3c4d5e6f708192a3b4c5d6e7" });
const INHERITED = [rows.changed("components-button--primary"), rows.fresh("components-badge--new"), rows.tall("pages-settings--account")];
const OWN = rows.taller("components-list--with-new-row");
const sinceBase = (...changed: readonly ReturnType<typeof rows.changed>[]) => ({ base: BASE, rows: changed.map((row) => ({ ...row, goldenBatchId: OTHER_BATCH_ID, approvedIn: null })) });
export const InheritedFromBase: Story = { args: { view: viewOf(INHERITED), state: { sinceBase: sinceBase() } } };
export const ChangedSinceBase: Story = {
  args: { view: viewOf([...INHERITED, OWN]), state: { sinceBase: { base: BASE, rows: [...sinceBase(OWN).rows, { ...rows.spaced("pages-home--with-more-space", approved()), goldenBatchId: OTHER_BATCH_ID, approvedIn: OTHER_BATCH_ID }] } } },
};
export const ChangedSinceBaseListed: Story = { ...ChangedSinceBase, args: { ...ChangedSinceBase.args, search: "?show=since-base" } };
export const NoBase: Story = { args: { view: viewOf(SOME_CHANGES), state: { sinceBase: { base: null, rows: [] } }, search: "?show=since-base" } };
