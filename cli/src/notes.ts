// What a person says about what they see, for an agent to act on. Local only, like `render_keys`: it's
// in the project's `store.db`, and not in the store's schema, which D1 also has. Each worktree's folder
// is its own session, so parallel worktrees share a store and never each other's notes.
//
// A note is where something is, and its messages are the conversation about it. Being sent belongs to
// a message and not to a note, since a person's reply to a note that's already been read is a draft too.
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawImage, Sql, SqlRow } from "selfie-store";
import type { BoundingBox, NewNote, Note, NoteMessage, NoteState } from "selfie-ui/app";
import { describeBox } from "selfie-ui/regions";
import { SelfieError } from "./errors.ts";
import { encodePng } from "./png.ts";
import type { Project } from "./project.ts";

export const CREATE_NOTES_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  story TEXT NOT NULL,
  run_id TEXT NOT NULL,
  image_hash TEXT,
  box TEXT,
  resolved_at INTEGER
)`,
  "CREATE INDEX IF NOT EXISTS notes_by_session ON notes(session, id)",
  `CREATE TABLE IF NOT EXISTS note_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  run_id TEXT,
  at INTEGER NOT NULL,
  sent_at INTEGER,
  delivered_at INTEGER
)`,
  "CREATE INDEX IF NOT EXISTS note_messages_by_note ON note_messages(note_id, id)",
];

/** The notes of one session. */
export interface Notes {
  /** Oldest first. */
  list(): Promise<readonly Note[]>;
  add(note: NewNote, author: string): Promise<void>;
  /** Removes what's not been sent of a note, and the note if nothing's left. What's been sent has been read. */
  removeDraft(id: number): Promise<void>;
  /** Sends every draft. */
  send(): Promise<void>;
}

const stateOf = (messages: readonly NoteMessage[]): NoteState => (messages[0]?.sent === false ? "draft" : "sent");

export function notesIn(sql: Sql, session: string): Notes {
  return {
    async list() {
      const [notes, messages] = await Promise.all([
        sql.run({ sql: "SELECT id, story, run_id, image_hash, box FROM notes WHERE session = ?1 ORDER BY id", params: [session], idempotent: true }),
        sql.run({
          sql: `SELECT m.note_id, m.sender, m.author, m.text, m.run_id, m.at, m.sent_at FROM note_messages m
JOIN notes n ON n.id = m.note_id WHERE n.session = ?1 ORDER BY m.id`,
          params: [session],
          idempotent: true,
        }),
      ]);
      const byNote = new Map<number, NoteMessage[]>();
      for (const row of messages) {
        const noteId = row.note_id as number;
        byNote.set(noteId, [...(byNote.get(noteId) ?? []), toMessage(row)]);
      }
      // Adding one isn't atomic here, so a crash can leave a note with nothing said.
      return notes.flatMap((row) => {
        const said = byNote.get(row.id as number);
        return said === undefined ? [] : [toNote(row, said)];
      });
    },
    async add({ story, runId, imageHash, box, text }, author) {
      const at = Date.now();
      await sql.batch([
        {
          // A parameter can't be null, so nothing is an empty string on its way in.
          sql: "INSERT INTO notes(session, story, run_id, image_hash, box) VALUES (?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''))",
          params: [session, story, runId, imageHash ?? "", box === null ? "" : JSON.stringify(box)],
        },
        {
          sql: "INSERT INTO note_messages(note_id, sender, author, text, run_id, at) VALUES (last_insert_rowid(), 'person', ?1, ?2, ?3, ?4)",
          params: [author, text, runId, at],
        },
      ]);
    },
    async removeDraft(id) {
      const [removed] = await sql.batch([
        {
          sql: `DELETE FROM note_messages WHERE note_id = ?2 AND sent_at IS NULL
  AND note_id IN (SELECT id FROM notes WHERE session = ?1) RETURNING id`,
          params: [session, id],
        },
        {
          sql: "DELETE FROM notes WHERE session = ?1 AND id = ?2 AND NOT EXISTS (SELECT 1 FROM note_messages WHERE note_id = ?2)",
          params: [session, id],
        },
      ]);
      if (removed!.length === 0) throw new SelfieError("unknown-note", `This folder has no draft on note ${id}.`);
    },
    async send() {
      const at = Date.now();
      await sql.run({
        sql: `UPDATE note_messages SET sent_at = ?2, delivered_at = ?2 WHERE sent_at IS NULL
  AND note_id IN (SELECT id FROM notes WHERE session = ?1)`,
        params: [session, at],
      });
    },
  };
}

const toMessage = (row: SqlRow): NoteMessage => ({
  sender: row.sender as NoteMessage["sender"],
  author: row.author as string,
  text: row.text as string,
  runId: row.run_id as string | null,
  at: row.at as number,
  sent: row.sent_at !== null,
});

const toNote = (row: SqlRow, messages: readonly NoteMessage[]): Note => ({
  id: row.id as number,
  story: row.story as string,
  runId: row.run_id as string,
  imageHash: row.image_hash as string | null,
  box: row.box === null ? null : (JSON.parse(row.box as string) as BoundingBox),
  state: stateOf(messages),
  messages,
});

/** What an agent may see of a session's notes: never a draft, which someone may still be writing. */
export const sentNotes = (notes: readonly Note[]): readonly Note[] =>
  notes.flatMap((note) => {
    const messages = note.messages.filter(({ sent }) => sent);
    return messages.length === 0 ? [] : [{ ...note, messages }];
  });

/** The hunk to paste into any coding agent. Never names a file, since it crosses the review server. */
export function textForAgent(notes: readonly Note[], folder: string): string {
  const header = `Feedback on the Storybook stories in the folder \`${folder}\`, as ${notes.length === 1 ? "1 note" : `${notes.length} notes`}. Run \`selfie notes\` there for the details of each, with a picture of what it's about.`;
  const bodies = notes.map(({ id, story, box, messages }) => {
    const said = messages.map(({ text }) => text).join("\n\n");
    return `Note ${id}, on ${story}${box === null ? "" : `, in the box ${describeBox(box)}`}:\n${said}`;
  });
  return [header, ...bodies].join("\n\n");
}

const BOX_COLOR = [191, 0, 255] as const;
const BOX_THICKNESS = 3;

/** The image, with a box drawn just outside what the note is about, so the box covers none of it. */
export function withBoxDrawn({ width, height, pixels }: RawImage, { x, y, width: boxWidth, height: boxHeight }: BoundingBox): RawImage {
  const out = pixels.slice();
  const [left, top] = [x - BOX_THICKNESS, y - BOX_THICKNESS];
  const [right, bottom] = [x + boxWidth + BOX_THICKNESS, y + boxHeight + BOX_THICKNESS];
  for (let row = Math.max(top, 0); row < Math.min(bottom, height); row++) {
    for (let column = Math.max(left, 0); column < Math.min(right, width); column++) {
      if (row >= y && row < y + boxHeight && column >= x && column < x + boxWidth) continue;
      out.set(BOX_COLOR, (row * width + column) * 3);
    }
  }
  return { width, height, pixels: out };
}

const exists = (file: string) => access(file).then(
  () => true,
  () => false,
);

/** A picture of what a note is about, named for its content, so it's only ever made once. Null if it's about no image. */
async function exportNoteImage(project: Project, { imageHash, box }: Note): Promise<string | null> {
  if (imageHash === null) return null;
  const directory = path.join(project.directory, "notes");
  const file = path.join(directory, `${imageHash}${box === null ? "" : `-${box.x}-${box.y}-${box.width}-${box.height}`}.png`);
  if (await exists(file)) return file;
  const pixels = await project.store.getPixels(imageHash);
  if (pixels === null) return null;
  await mkdir(directory, { recursive: true });
  // Atomic, so a crash can't leave half of one to be found next time.
  await writeFile(`${file}.tmp`, await encodePng(box === null ? pixels : withBoxDrawn(pixels, box)));
  await rename(`${file}.tmp`, file);
  return file;
}

/** What `selfie notes` prints. One at a time, since each may decode a whole image. */
export async function notesForAgent(project: Project): Promise<{ readonly folder: string; readonly notes: readonly (Note & { readonly image: string | null })[] }> {
  const notes = [];
  for (const note of sentNotes(await project.notes.list())) notes.push({ ...note, image: await exportNoteImage(project, note) });
  return { folder: project.repo.root, notes };
}
