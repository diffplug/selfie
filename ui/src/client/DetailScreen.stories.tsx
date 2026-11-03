import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Note, RunView, SnapshotRow } from "../shared/api.ts";
import { useState } from "react";
import { DetailScreen } from "./DetailScreen.tsx";
import { approved, feedbackOf, note, OTHER_RUN_ID, rejected, replied, rows, stateOf, viewOf } from "./stories/fixtures.ts";
import { HASHES } from "./stories/images.generated.ts";

interface Args {
  readonly row: SnapshotRow;
  readonly others?: readonly SnapshotRow[];
  readonly view?: RunView;
  readonly notes?: readonly Note[];
}

function Screen({ row, others = [], view, notes = [] }: Args) {
  const shown = view ?? viewOf([row, ...others]);
  return <DetailScreen state={stateOf(shown)} view={shown} story={row.story} search="" feedback={feedbackOf(notes)} />;
}

const meta = { title: "Screens/Snapshot", component: Screen } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

const press = (...keys: readonly string[]) => async () => {
  for (const key of keys) await userEvent.keyboard(key);
};

/** Stacking centers, and outlines are drawn, once every image has a size, so nothing's settled until then. */
const stackedImagesLoaded = (canvasElement: HTMLElement) =>
  waitFor(() => {
    for (const image of canvasElement.querySelectorAll<HTMLElement>(".selfie-layer")) expect(image.style.width).not.toBe("");
  });

const SEVERAL = rows.several("pages-home--rearranged");
const BUTTON = rows.changed("components-button--primary");
const NEIGHBORS = [rows.fresh("components-badge--new"), rows.tall("pages-settings--account")];

export const Changed: Story = { args: { row: BUTTON, others: NEIGHBORS } };
export const WithStorybook: Story = {
  args: { row: BUTTON, view: { ...viewOf([BUTTON]), storybook: { url: "http://127.0.0.1:51234/storybook-builds/abc/", exactBuild: true } } },
};
export const WithStorybookOfAnotherBuild: Story = {
  args: { row: BUTTON, view: { ...viewOf([BUTTON]), storybook: { url: "http://127.0.0.1:51234/", exactBuild: false } } },
};
const FRESH = rows.fresh("components-badge--new");
const liveView = (row: SnapshotRow, overrides: Partial<RunView> = {}): RunView => ({
  ...viewOf([row]),
  storybook: { url: "./live-story/current/", exactBuild: true },
  goldenStorybookUrl: "./live-story/golden/",
  ...overrides,
});
const liveLoaded = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await press("l")();
  await waitFor(() => expect(within(canvasElement).getAllByTitle(/running/).length).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 300));
};
export const LiveStoriesOpen: Story = { args: { row: BUTTON, view: liveView(BUTTON) }, play: liveLoaded };
export const LiveStoriesNewStory: Story = { args: { row: FRESH, view: liveView(FRESH) }, play: liveLoaded };
export const LiveStoriesGoldenNotKept: Story = { args: { row: BUTTON, view: liveView(BUTTON, { goldenStorybookUrl: null }) }, play: liveLoaded };
export const LiveStoriesSizeUnknown: Story = { args: { row: BUTTON, view: liveView(BUTTON, { viewport: null }) }, play: liveLoaded };
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
      <DetailScreen state={stateOf(view)} view={view} story={story} search="" feedback={feedbackOf()} />
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
const onTheButton = { story: BUTTON.story, imageHash: BUTTON.imageHash, box: { x: 32, y: 450, width: 160, height: 36 } };

export const NotesOnThisStory: Story = {
  args: {
    row: BUTTON,
    notes: [
      note(11, { ...onTheButton, state: "sent", text: "Too quiet. Should this be the page's main action?" }),
      note(12, { story: BUTTON.story, imageHash: BUTTON.imageHash, text: "Also the whole page feels cramped, so\nlet's give it more room." }),
    ],
  },
};
export const NotesOnThisStoryStacked: Story = { args: { row: BUTTON, notes: [note(11, onTheButton)] }, play: press("f") };
export const WritingANote: Story = {
  args: { row: BUTTON },
  play: async () => {
    await press("m")();
    await userEvent.keyboard("This label is too quiet");
  },
};
export const WritingANoteOnSelectedRegions: Story = {
  args: { row: SEVERAL },
  play: async ({ canvasElement }) => {
    await press("x", "m")();
    await expect(within(canvasElement).getByText(/on 1 selected region of the current image/)).toBeVisible();
  },
};
export const DrawingABox: Story = {
  args: { row: BUTTON },
  play: async ({ canvasElement }) => {
    await press("f")();
    await stackedImagesLoaded(canvasElement);
    const stack = canvasElement.querySelector<HTMLElement>(".selfie-stack")!;
    const { left, top } = stack.getBoundingClientRect();
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: stack, coords: { clientX: left + 100, clientY: top + 60 } },
      { target: stack, coords: { clientX: left + 400, clientY: top + 160 } },
      { keys: "[/MouseLeft]", target: stack, coords: { clientX: left + 400, clientY: top + 160 } },
    ]);
    await expect(within(canvasElement).getByText(/on the box you drew/)).toBeVisible();
    await expect(canvasElement.querySelector(".selfie-note-box[data-drawing]")).not.toBeNull();
  },
};
/** A button an agent has since changed, and a note on the image from before that. */
const FIXED = rows.changed("components-button--primary");
const ON_THE_OLD_IMAGE = note(21, { story: FIXED.story, imageHash: HASHES.fresh, box: { x: 32, y: 360, width: 160, height: 36 }, state: "sent", text: "Make this green." });

export const AgentReplied: Story = { args: { row: FIXED, notes: [replied(ON_THE_OLD_IMAGE, "Made it green, in `Button.tsx`.")] } };
export const WhenNotedLayer: Story = {
  args: { row: FIXED, notes: [replied(ON_THE_OLD_IMAGE, "Made it green, in `Button.tsx`.")] },
  play: async ({ canvasElement }) => {
    await press("w")();
    await stackedImagesLoaded(canvasElement);
    await expect(within(canvasElement).getByText(/Showing/).textContent).toContain("when noted");
    await expect(canvasElement.querySelector(".selfie-note-box")).not.toBeNull();
  },
};
export const SelectedRegionsMeanNothingOnTheImageWhenNoted: Story = {
  args: { row: FIXED, notes: [replied(ON_THE_OLD_IMAGE, "Made it green, in `Button.tsx`.")] },
  play: async ({ canvasElement }) => {
    await press("x", "w")();
    await stackedImagesLoaded(canvasElement);
    await expect(within(canvasElement).getByText(/on all of the image when noted/)).toBeVisible();
    await expect(canvasElement.querySelector(".selfie-stack .selfie-region")).toBeNull();
  },
};
export const AgentClaimedAFixAndNothingMoved: Story = {
  args: { row: FIXED, notes: [replied(note(22, { story: FIXED.story, imageHash: FIXED.imageHash, state: "sent", text: "Make this bigger." }), "Made it bigger.")] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/identical to the one the note was written on/)).toBeVisible();
  },
};
export const AgentRepliedFromANewerRun: Story = {
  args: {
    row: FIXED,
    notes: [
      (() => {
        const answered = replied(note(25, { story: FIXED.story, imageHash: FIXED.imageHash, state: "sent", text: "Make this bigger." }), "Made it bigger.");
        return { ...answered, messages: answered.messages.map((message) => (message.sender === "agent" ? { ...message, runId: OTHER_RUN_ID } : message)) };
      })(),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/identical to the one the note was written on/)).toBeNull();
  },
};
export const ResolvedNote: Story = { args: { row: FIXED, notes: [note(23, { story: FIXED.story, imageHash: FIXED.imageHash, state: "resolved" })] } };
export const AnswerNotSentYet: Story = {
  args: {
    row: FIXED,
    notes: [
      (() => {
        const answered = replied(note(24, { story: FIXED.story, imageHash: FIXED.imageHash, state: "sent", text: "Make this bigger." }), "How much bigger?");
        return { ...answered, messages: [...answered.messages, { id: 9024, sender: "person" as const, author: "ned@example.com", text: "About double.", runId: null, at: 2, sent: false }] };
      })(),
    ],
  },
};
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
