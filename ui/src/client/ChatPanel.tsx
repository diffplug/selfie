// Asking Muse Spark about the change on this page. It's only ever asked, and decides nothing.
import { Button, Stack, Text, Textarea } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { MAX_QUESTION_CHARACTERS, type ChatCode, type ChatMessage, type ChatUpdate } from "../shared/chat.ts";
import { plural } from "../shared/plural.ts";
import { askAboutStory } from "./api.ts";
import { ErrorText } from "./ActionFailure.tsx";
import { asRequestError } from "./hooks.ts";
import { Sha } from "./words.tsx";

const STARTERS = ["What code caused this change?", "Does this look intended?"];

/** What the model was shown, so that nobody takes an answer for more than it read. */
function CodeShown({ code }: { readonly code: ChatCode | null | undefined }) {
  if (code === undefined) return null;
  if (code === null) return <Text as="p" className="selfie-small selfie-muted">GitHub couldn't say what code changed, so this comes from the images alone.</Text>;
  const range = (
    <>
      <Sha sha={code.base} />…<Sha sha={code.head} />
    </>
  );
  const leftOut = code.leftOut.length === 0 ? "" : `, without the text of ${code.leftOut.length}: ${code.leftOut.slice(0, 5).join(", ")}${code.leftOut.length > 5 ? ", …" : ""}`;
  return (
    <Text as="p" className="selfie-small selfie-muted">
      {code.files === 0 ? <>No code changed in {range}.</> : <>Read {plural(code.files, "file")} from {range}{leftOut}.</>}
    </Text>
  );
}

export interface ChatPanelProps {
  readonly batchId: string;
  readonly story: string;
  /** Stories stand in for the server here, and start part way through a conversation. */
  readonly ask?: typeof askAboutStory;
  readonly initial?: { readonly messages: readonly ChatMessage[]; readonly code?: ChatCode | null; readonly error?: string };
}

export function ChatPanel({ batchId, story, ask = askAboutStory, initial }: ChatPanelProps) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initial?.messages ?? []);
  const [code, setCode] = useState(initial?.code);
  const [error, setError] = useState<Error | null>(initial?.error === undefined ? null : new Error(initial.error));
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const send = async (question: string) => {
    if (asking || question.trim() === "") return;
    const asked: readonly ChatMessage[] = [...messages, { from: "person", text: question }];
    setMessages(asked);
    setText("");
    setError(null);
    setAsking(true);
    const controller = new AbortController();
    inFlight.current = controller;
    let answer = "";
    const onUpdate = (update: ChatUpdate) => {
      if (update.type === "code") {
        setCode(update.code);
      } else {
        answer += update.text;
        setMessages([...asked, { from: "model", text: answer }]);
      }
    };
    try {
      await ask(batchId, { story, messages: asked }, onUpdate, controller.signal);
    } catch (thrown) {
      if (controller.signal.aborted) return;
      setError(asRequestError(thrown));
      // A conversation goes on only from a whole answer, so this goes back to before the question, ready to ask again.
      setMessages(messages);
      setText(question);
    }
    setAsking(false);
  };

  return (
    <section className="selfie-chat" aria-label="Ask about this change">
      {messages.length > 0 && (
        <div className="selfie-chat-log" role="log">
          {messages.map(({ from, text: said }, index) => (
            <Text as="p" key={index} className="selfie-chat-message" data-from={from}>
              <strong>{from === "person" ? "You: " : "Muse Spark: "}</strong>
              {said}
            </Text>
          ))}
          {asking && messages.at(-1)?.from === "person" && <Text as="p" className="selfie-small selfie-muted">Reading the images and the code…</Text>}
          <CodeShown code={code} />
        </div>
      )}
      {error !== null && (
        <Text as="p" className="selfie-chat-error" role="alert">
          <ErrorText error={error} />
        </Text>
      )}
      <form
        className="selfie-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label className="selfie-small" htmlFor="selfie-chat-text">
          Ask Muse Spark about this change. It reads these images and the code from GitHub, and can be wrong.
        </label>
        <Stack direction="horizontal" align="start" gap="condensed">
          <Textarea
            id="selfie-chat-text"
            block
            rows={1}
            resize="vertical"
            maxLength={MAX_QUESTION_CHARACTERS}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(text);
              }
              if (event.key === "Escape") event.currentTarget.blur();
            }}
          />
          <Button type="submit" disabled={asking || text.trim() === ""}>
            Ask
          </Button>
        </Stack>
        {messages.length === 0 && (
          <Stack direction="horizontal" wrap="wrap" gap="condensed">
            {STARTERS.map((starter) => (
              <Button key={starter} size="small" disabled={asking} onClick={() => void send(starter)}>
                {starter}
              </Button>
            ))}
          </Stack>
        )}
      </form>
    </section>
  );
}
