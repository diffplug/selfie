// What's been said about one story, and saying more.
import { CheckIcon, TrashIcon } from "@primer/octicons-react";
import { Button, IconButton, Stack, Text, Textarea } from "@primer/react";
import { useState, type ReactNode, type RefObject } from "react";
import type { Note } from "../shared/api.ts";
import { describeBox } from "../shared/hunks.ts";
import { Keys } from "./Keys.tsx";
import { NoteLabel } from "./words.tsx";

/** A box to write in, which empties once what's in it has been saved. */
function Writing({
  id,
  label,
  button,
  onSave,
  writing,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly button: string;
  readonly onSave: (text: string) => Promise<boolean>;
  readonly writing?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving || text.trim() === "") return;
    setSaving(true);
    if (await onSave(text)) setText("");
    setSaving(false);
  };
  return (
    <form
      className="selfie-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="selfie-small" htmlFor={id}>
        {label}
      </label>
      <Stack direction="horizontal" align="start" gap="condensed">
        <Textarea
          id={id}
          {...(writing === undefined ? {} : { ref: writing })}
          block
          rows={1}
          resize="vertical"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
        <Button type="submit" disabled={saving || text.trim() === ""}>
          {button}
        </Button>
      </Stack>
    </form>
  );
}

type NoteActions = Pick<NotesPanelProps, "batchId" | "currentImage" | "onRemove" | "onAnswer" | "onResolve">;

function NoteItem({ note, batchId, currentImage, onRemove, onAnswer, onResolve }: NoteActions & { readonly note: Note }) {
  const hasDraft = note.messages.some(({ sent }) => !sent);
  // Only on the batch the agent answered from: on an older one, it's simply where the note was written.
  const answeredHere = note.messages.findLast(({ sender }) => sender === "agent")?.batchId === batchId;
  const unmoved = note.state === "replied" && answeredHere && note.imageHash !== null && note.imageHash === currentImage;
  return (
    <li data-state={note.state}>
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        <span className="selfie-note-number">Note {note.id}</span>
        <NoteLabel state={note.state} />
        {note.box !== null && <Text className="selfie-muted selfie-small">{describeBox(note.box)}</Text>}
        {hasDraft && <IconButton icon={TrashIcon} aria-label={`Delete what hasn't been sent of note ${note.id}`} size="small" variant="invisible" onClick={() => onRemove(note.id)} />}
        {note.state !== "draft" && note.state !== "resolved" && (
          <Button size="small" leadingVisual={CheckIcon} onClick={() => onResolve(note.id)}>
            Resolve
          </Button>
        )}
      </Stack>
      {note.messages.map(({ id, sender, sent, text }) => (
        <Text as="p" key={id} className="selfie-note-text" data-sender={sender}>
          {note.messages.length > 1 && <strong>{sender === "agent" ? "Agent: " : sent ? "You: " : "You, not sent yet: "}</strong>}
          {text}
        </Text>
      ))}
      {unmoved && (
        <Text as="p" className="selfie-note-unmoved selfie-small">
          This image is identical to the one the note was written on.
        </Text>
      )}
      {!hasDraft && <Writing id={`selfie-answer-${note.id}`} label={note.state === "resolved" ? "Reopen it with an answer" : "Answer"} button="Answer" onSave={(text) => onAnswer(note.id, text)} />}
    </li>
  );
}

interface NotesPanelProps {
  readonly notes: readonly Note[];
  /** The batch being looked at, and the image this story has in it. */
  readonly batchId: string;
  readonly currentImage: string | null;
  /** What a note written now would be about, in words. */
  readonly target: string;
  /** Which image dragging draws a box on, in words. */
  readonly drawsOn: string;
  /** True if the note was saved. */
  readonly onAdd: (text: string) => Promise<boolean>;
  readonly onRemove: (id: number) => void;
  readonly onAnswer: (id: number, text: string) => Promise<boolean>;
  readonly onResolve: (id: number) => void;
  readonly writing: RefObject<HTMLTextAreaElement | null>;
}

export function NotesPanel({ notes, target, drawsOn, onAdd, writing, ...actions }: NotesPanelProps) {
  return (
    <section className="selfie-notes" aria-label="Notes">
      {notes.length > 0 && (
        <ul className="selfie-notes-list">
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} {...actions} />
          ))}
        </ul>
      )}
      <Writing
        id="selfie-note-text"
        writing={writing}
        button="Add note"
        onSave={onAdd}
        label={
          <>
            Note for your agent, <strong>{target}</strong>. <Keys keys="m" /> starts one, and dragging on {drawsOn} draws a box.
          </>
        }
      />
    </section>
  );
}
