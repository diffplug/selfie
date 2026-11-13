// What crosses between the page and the Worker when someone asks about a story's change. See docs/specs/chat.md.

const MAX_CHAT_MESSAGES = 40;
export const MAX_QUESTION_CHARACTERS = 4_000;
/** Far past what the model may answer in, which only a page's own replay of it would reach. */
const MAX_ANSWER_CHARACTERS = 40_000;

export interface ChatMessage {
  readonly from: "person" | "model";
  readonly text: string;
}

/** What code the model was shown, so that nobody takes an answer for more than it read. */
export interface ChatCode {
  readonly base: string;
  readonly head: string;
  readonly files: number;
  /** Changed files it wasn't shown the text of. */
  readonly leftOut: readonly string[];
}

/** A line of the answer's body, in order: one `code`, any number of `text`, and then `done` or `failed`. */
export type ChatEvent =
  | { readonly type: "code"; readonly code: ChatCode | null }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "done" }
  /** `id` is the error's code, which the server logged it under. */
  | { readonly type: "failed"; readonly message: string; readonly id: string };

/** What a page does anything with as an answer comes in, since how it ends is for whatever's reading the body. */
export type ChatUpdate = Extract<ChatEvent, { readonly type: "code" | "text" }>;

/** A body's lines as they arrive, stopping it if nobody reads to the end. */
export async function* linesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      held += decoder.decode(value, { stream: true });
      const lines = held.split("\n");
      held = lines.pop()!;
      yield* lines;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** A conversation the model can be asked to go on with: taking turns, starting and ending with the person. */
export function isConversation(value: unknown): value is readonly ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHAT_MESSAGES || value.length % 2 === 0) return false;
  return value.every((message: unknown, index) => {
    const { from, text } = (message ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "") return false;
    return index % 2 === 0 ? from === "person" && text.length <= MAX_QUESTION_CHARACTERS : from === "model" && text.length <= MAX_ANSWER_CHARACTERS;
  });
}
