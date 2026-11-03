import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { note, OTHER_RUN_ID, replied, rows } from "./stories/fixtures.ts";
import { HASHES } from "./stories/images.generated.ts";
import { BUTTON, SEVERAL, StoryPage, press, stackedImagesLoaded } from "./stories/storyPage.tsx";

const meta = { title: "Pages/Story/Notes", component: StoryPage } satisfies Meta<typeof StoryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The agent's change to an added story, which has no golden: what's compared is the image the note is on. */
const SINCE_NOTED = { ...BUTTON, state: "added" as const, goldenHash: null, pixelDiff: null };
export const NewStoryComparedWithItsNote: Story = {
  args: { row: SINCE_NOTED, notes: [note(1, { story: BUTTON.story, imageHash: BUTTON.goldenHash })] },
};
export const NewStoryComparedWithItsNoteStacked: Story = {
  args: { row: SINCE_NOTED, notes: [note(1, { story: BUTTON.story, imageHash: BUTTON.goldenHash })] },
  play: press("f", "f"),
};
export const NewStoryWithANoteOnItself: Story = {
  args: { row: SINCE_NOTED, notes: [note(1, { story: BUTTON.story, imageHash: BUTTON.imageHash })] },
};
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
