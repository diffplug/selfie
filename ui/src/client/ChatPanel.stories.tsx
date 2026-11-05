import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { ChatUpdate } from "../shared/chat.ts";
import { RequestError } from "./api.ts";
import { ChatPanel, type ChatPanelProps } from "./ChatPanel.tsx";
import { BATCH_ID } from "./stories/fixtures.ts";

const meta = { title: "Parts/Chat", component: ChatPanel, args: { batchId: BATCH_ID, story: "components-button--primary" } } satisfies Meta<typeof ChatPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

const BASE = "05a05880e31243f9906ab509d06acb76de444250";
const HEAD = "46f7d4e1c0f5a6b7d8e9f0a1b2c3d4e5f6a7b8c9";
const QUESTION = { from: "person", text: "What code caused this change?" } as const;
const ANSWER = { from: "model", text: "The button got taller. My best guess is ui/src/client/styles.css, where this commit changes padding: 4px 8px to padding: 8px 12px on .selfie-button. I'm inferring that from the diff, and nothing else in it touches buttons.\n\nThe commit message only mentions spacing in the list, so check that this was wanted." } as const;
const ask = (updates: readonly ChatUpdate[]): ChatPanelProps["ask"] =>
  async (_batchId, _question, onUpdate) => {
    for (const update of updates) onUpdate(update);
  };

export const NothingAskedYet: Story = {};
export const AnAnswer: Story = { args: { initial: { messages: [QUESTION, ANSWER], code: { base: BASE, head: HEAD, files: 4, leftOut: [] } } } };
export const SomeCodeLeftOut: Story = { args: { initial: { messages: [QUESTION, ANSWER], code: { base: BASE, head: HEAD, files: 40, leftOut: ["pnpm-lock.yaml", "ui/src/client/stories/images.generated.ts", "branding/mascot.webp", "docs/big.md", "cli/src/huge.ts", "store/src/huge.ts"] } } } };
export const NoCodeChanged: Story = { args: { initial: { messages: [QUESTION, { from: "model", text: "No code changed between these commits, so this probably came from something unstable in the render." }], code: { base: HEAD, head: HEAD, files: 0, leftOut: [] } } } };
export const GitHubCouldNotSay: Story = { args: { initial: { messages: [QUESTION, { from: "model", text: "I only have the images. The button is taller, and its text moved down by 4 pixels." }], code: null } } };
export const CouldNotAnswer: Story = { args: { initial: { messages: [], error: "Muse Spark couldn't answer that. Try again in a moment." } } };
export const AskingWithAStarter: Story = {
  args: { ask: ask([{ type: "code", code: { base: BASE, head: HEAD, files: 4, leftOut: [] } }, { type: "text", text: "The button got " }, { type: "text", text: "taller." }]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Does this look intended?" }));
    await expect(await canvas.findByText("The button got taller.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Does this look intended?" })).toBeNull();
  },
};
export const AQuestionThatFails: Story = {
  args: {
    ask: async () => {
      throw new RequestError("too-many-questions", "That's a lot of questions. Wait a minute, and ask again.");
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "Why is this taller?{Enter}");
    await expect(await canvas.findByRole("alert")).toHaveTextContent("a lot of questions");
    await expect(canvas.getByRole("textbox")).toHaveValue("Why is this taller?");
  },
};
