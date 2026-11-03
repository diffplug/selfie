// What's on its way to an agent, on every screen of a run: how many notes, and how to hand them over.
import { Button, Dialog, Stack, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import type { FeedbackState } from "./hooks.ts";
import { plural } from "./plural.ts";
import { AppLink, storyPath } from "./router.tsx";
import { ActionFailedBanner } from "./RunNotes.tsx";
import { NoteLabel } from "./words.tsx";

function CopyDialog({ text, onClose }: { readonly text: string; readonly onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => {
        // A browser may refuse, so leave it ready for someone to copy themselves.
        setCopied(false);
        area.current?.select();
      },
    );
  };
  useEffect(copy, [text]);
  return (
    <Dialog
      title={copied === true ? "Copied. Paste it into your agent" : "Copy this into your agent"}
      onClose={onClose}
      width="xlarge"
      footerButtons={[
        { buttonType: "default", content: "Copy again", onClick: copy },
        { buttonType: "primary", content: "Done", onClick: onClose },
      ]}
    >
      {copied === false && (
        <Text as="p" className="selfie-muted">
          The browser wouldn't copy it, so it's selected here for you to copy.
        </Text>
      )}
      <textarea ref={area} className="selfie-copy-text" aria-label="Text for your agent" readOnly rows={12} value={text} />
    </Dialog>
  );
}

/** Nothing at all with no notes, so a person who isn't using an agent never sees it. */
export function FeedbackBar({ feedback, runId, showList }: { readonly feedback: FeedbackState; readonly runId: string; readonly showList: boolean }) {
  const { view, error, clearError, send } = feedback;
  const [text, setText] = useState<string | null>(null);
  const notes = view?.notes ?? [];
  if (notes.length === 0 && error === null && text === null) return null;
  return (
    <section className="selfie-feedback" aria-label="Notes for your agent">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Text>
          <strong>{plural(notes.length, "note")}</strong> for your agent.
        </Text>
        <Button variant="primary" onClick={() => void send().then(setText)}>
          Copy for agent
        </Button>
      </Stack>
      {error !== null && <ActionFailedBanner error={error} onDismiss={clearError} />}
      {showList && (
        <ul className="selfie-feedback-list">
          {notes.map(({ id, story, state, messages }) => (
            <li key={id}>
              <NoteLabel state={state} />
              <AppLink href={storyPath(runId, story, "")}>{story}</AppLink>
              <span className="selfie-muted selfie-note-preview">{messages.at(-1)?.text}</span>
            </li>
          ))}
        </ul>
      )}
      {text !== null && <CopyDialog text={text} onClose={() => setText(null)} />}
    </section>
  );
}
