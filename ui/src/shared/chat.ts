// What crosses between the page and the Worker when someone asks about a story's change. See docs/specs/chat.md.

export const MAX_CHAT_MESSAGES = 40;
export const MAX_QUESTION_CHARACTERS = 4_000;
/** Far past what the model may answer in, which only a page's own replay of it would reach. */
export const MAX_ANSWER_CHARACTERS = 40_000;

export interface ChatMessage {
  readonly from: "person" | "model";
  readonly text: string;
}

/** What code the model was shown, so that nobody takes an answer for more than it read. */
export interface ChatCode {
  readonly base: string;
  readonly head: string;
  readonly commits: number;
  readonly files: number;
  /** Changed files it wasn't shown the text of. */
  readonly leftOut: readonly string[];
}

/** A line of the answer's body, in order: one `code`, any number of `text`, and then `done` or `failed`. */
export type ChatEvent =
  | { readonly type: "code"; readonly code: ChatCode | null }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "done" }
  | { readonly type: "failed"; readonly message: string };

/** A conversation the model can be asked to go on with: taking turns, starting and ending with the person. */
export function isConversation(value: unknown): value is readonly ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHAT_MESSAGES || value.length % 2 === 0) return false;
  return value.every((message: unknown, index) => {
    const { from, text } = (message ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "") return false;
    return index % 2 === 0 ? from === "person" && text.length <= MAX_QUESTION_CHARACTERS : from === "model" && text.length <= MAX_ANSWER_CHARACTERS;
  });
}
