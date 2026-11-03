import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { Note } from "../shared/api.ts";
import { FeedbackBar } from "./Feedback.tsx";
import { failure, feedbackOf, note, RUN_ID } from "./stories/fixtures.ts";

interface Args {
  readonly notes?: readonly Note[];
  readonly showList?: boolean;
  readonly failed?: boolean;
  readonly agentWaiting?: boolean;
}

function Bar({ notes = [], showList = true, failed = false, agentWaiting = false }: Args) {
  const feedback = feedbackOf(notes, failed ? { error: failure("unreachable", "Can't reach the Selfie server. Is selfie ui still running?") } : {}, agentWaiting);
  return <FeedbackBar feedback={feedback} runId={RUN_ID} showList={showList} />;
}

const meta = { title: "Screens/Feedback", component: Bar } satisfies Meta<typeof Bar>;
export default meta;
type Story = StoryObj<typeof meta>;

const SOME = [
  note(11, { state: "sent", text: "Too quiet. Should this be the page's main action?" }),
  note(12, { story: "pages-home--default", text: "A note long enough that it has to stop somewhere in the list, since a long one shouldn't wrap and push everything else down the page, however much someone had to say about this." }),
];

export const NoNotesShowsNothing: Story = { args: {} };
export const NotesInTheRunList: Story = { args: { notes: SOME } };
export const NotesOnAStorysPage: Story = { args: { notes: SOME, showList: false } };
export const CouldNotReachTheServer: Story = { args: { notes: SOME, failed: true } };
export const AgentWaitingWithDrafts: Story = { args: { notes: SOME, agentWaiting: true } };
export const AgentWaitingWithNothingToSend: Story = { args: { notes: [], agentWaiting: true } };
export const AgentWaitingWithAllSent: Story = { args: { notes: [SOME[0]!], agentWaiting: true } };
export const CopyDialog: Story = {
  args: { notes: SOME },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Copy for agent" }));
    await expect(within(document.body).findByRole("textbox", { name: "Text for your agent" })).resolves.toBeVisible();
  },
};
