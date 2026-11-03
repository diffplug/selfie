// What's been said about one story, and saying more.
import { TrashIcon } from "@primer/octicons-react";
import { Button, IconButton, Stack, Text, Textarea } from "@primer/react";
import { useState, type RefObject } from "react";
import type { Note } from "../shared/api.ts";
import { describeBox } from "../shared/regions.ts";
import { Keys } from "./Keys.tsx";
import { NoteLabel } from "./words.tsx";

interface NotesPanelProps {
  readonly notes: readonly Note[];
  /** What a note written now would be about, in words. */
  readonly target: string;
  /** True if the note was saved. */
  readonly onAdd: (text: string) => Promise<boolean>;
  readonly onRemove: (id: number) => void;
  readonly writing: RefObject<HTMLTextAreaElement | null>;
}

export function NotesPanel({ notes, target, onAdd, onRemove, writing }: NotesPanelProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (saving || text.trim() === "") return;
    setSaving(true);
    if (await onAdd(text)) setText("");
    setSaving(false);
  };
  return (
    <section className="selfie-notes" aria-label="Notes">
      {notes.length > 0 && (
        <ul className="selfie-notes-list">
          {notes.map((note) => (
            <li key={note.id}>
              <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
                <span className="selfie-note-number">Note {note.id}</span>
                <NoteLabel state={note.state} />
                {note.box !== null && <Text className="selfie-muted selfie-small">{describeBox(note.box)}</Text>}
                {note.state === "draft" && <IconButton icon={TrashIcon} aria-label={`Delete note ${note.id}`} size="small" variant="invisible" onClick={() => onRemove(note.id)} />}
              </Stack>
              {note.messages.map(({ id, text: said }) => (
                <Text as="p" key={id} className="selfie-note-text">
                  {said}
                </Text>
              ))}
            </li>
          ))}
        </ul>
      )}
      <form
        className="selfie-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="selfie-small" htmlFor="selfie-note-text">
          Note for your agent, <strong>{target}</strong>. <Keys keys="m" /> starts one, and dragging on a stacked image draws a box.
        </label>
        <Stack direction="horizontal" align="start" gap="condensed">
          <Textarea
            id="selfie-note-text"
            ref={writing}
            block
            rows={1}
            resize="vertical"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void add();
              if (event.key === "Escape") event.currentTarget.blur();
            }}
          />
          <Button type="submit" disabled={saving || text.trim() === ""}>
            Add note
          </Button>
        </Stack>
      </form>
    </section>
  );
}
