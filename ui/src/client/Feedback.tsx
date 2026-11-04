// What's on its way to an agent, on every screen of a batch: how many notes, and how to hand them over.
import { Banner, Button, Dialog, Stack, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { isOpenNote } from "../shared/notes.ts";
import type { FeedbackState } from "./hooks.ts";
import { plural } from "./plural.ts";
import { AppLink, batchPath, storyPath } from "./router.tsx";
import { ActionFailedBanner } from "./BatchNotes.tsx";
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

/**
 * When something's been recorded from this folder since. It offers to go there, and never goes by
 * itself, so an image can't change while someone is looking at it.
 */
export function NewerBatchBanner({ latestBatchId, batchId, story }: { readonly latestBatchId: string | null | undefined; readonly batchId: string; readonly story: string | null }) {
  if (latestBatchId === null || latestBatchId === undefined || latestBatchId === batchId) return null;
  return (
    <div className="selfie-newer-batch">
      <Banner
        variant="info"
        title="This isn't the newest batch from this folder"
        description={
          <AppLink inline href={story === null ? batchPath(latestBatchId) : storyPath(latestBatchId, story, "")}>
            Go to the newest{story === null ? "" : ", on this story"}
          </AppLink>
        }
      />
    </div>
  );
}

/** Nothing at all with no notes and no agent waiting, so a person who isn't using an agent never sees it. */
export function FeedbackBar({ feedback, storyHref, showList }: { readonly feedback: FeedbackState; readonly storyHref: (story: string) => string; readonly showList: boolean }) {
  const { view, error, clearError, send } = feedback;
  const [text, setText] = useState<string | null>(null);
  const notes = (view?.notes ?? []).filter(isOpenNote);
  const agentWaiting = view?.agentWaiting ?? false;
  const drafts = notes.filter(({ messages }) => messages.some(({ sent }) => !sent)).length;
  if (notes.length === 0 && !agentWaiting && error === null && text === null) return null;
  return (
    <section className="selfie-feedback" aria-label="Notes for your agent">
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="condensed">
        <Text>
          {agentWaiting && <strong>Your agent is waiting for feedback. </strong>}
          {plural(drafts, "draft")}, {plural(notes.length, "note")} in all.
          {agentWaiting && drafts === 0 && " Write a note on any story to send it."}
        </Text>
        <Stack direction="horizontal" align="center" gap="condensed">
          <Button variant={agentWaiting ? "default" : "primary"} disabled={notes.length === 0} onClick={() => void send("copy").then(setText)}>
            Copy for agent
          </Button>
          {agentWaiting && (
            <Button variant="primary" disabled={drafts === 0} onClick={() => void send("agent")}>
              Send to agent
            </Button>
          )}
        </Stack>
      </Stack>
      {error !== null && <ActionFailedBanner error={error} onDismiss={clearError} />}
      {showList && (
        <ul className="selfie-feedback-list">
          {notes.map(({ id, story, state, messages }) => (
            <li key={id}>
              <NoteLabel state={state} />
              <AppLink href={storyHref(story)}>{story}</AppLink>
              <span className="selfie-muted selfie-note-preview">{messages.at(-1)?.text}</span>
            </li>
          ))}
        </ul>
      )}
      {text !== null && <CopyDialog text={text} onClose={() => setText(null)} />}
    </section>
  );
}
