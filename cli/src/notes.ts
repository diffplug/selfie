// What a person says about what they see, for an agent to act on. Local only, like `render_keys`: it's
// in the project's `store.db`, and not in the store's schema, which D1 also has. Each worktree's folder
// is its own session, so parallel worktrees share a store and never each other's notes.
//
// A note is where something is, and its messages are the conversation about it. Being sent belongs to
// a message and not to a note, since a person's reply to a note that's already been read is a draft too.
import { randomUUID } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { RawImage, Sql, SqlRow } from "selfie-store";
import type { BoundingBox, NewNote, Note, NoteMessage, NoteState } from "selfie-ui/app";
import { isOpenNote } from "selfie-ui/notes";
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
  `CREATE TABLE IF NOT EXISTS note_sessions (
  session TEXT PRIMARY KEY,
  latest_run TEXT NOT NULL
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS note_waiters (
  session TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  heartbeat_at INTEGER NOT NULL
) WITHOUT ROWID`,
];

/** How long since its last heartbeat an agent still counts as waiting, which is a couple it could miss. */
export const WAITER_STALE_MS = 6_000;
const WAITER_BEAT_MS = 2_000;
/** How often a waiting agent looks for what's been sent, which is only a read. */
const WAITER_POLL_MS = 1_000;

/** The notes of one session. */
export interface Notes {
  /** Oldest first. */
  list(): Promise<readonly Note[]>;
  add(note: NewNote, author: string): Promise<void>;
  /** Removes what's not been sent of a note, and the note if nothing's left. What's been sent has been read. */
  removeDraft(id: number): Promise<void>;
  /** Sends every draft. */
  send(): Promise<void>;
  /** A person's answer, which is a draft until it's sent, and which reopens a resolved note. */
  answer(id: number, text: string, author: string, runId: string | null): Promise<void>;
  /** An agent's answer. It's already been read by whoever wrote it, so it's never new to an agent. */
  reply(id: number, text: string, runId: string | null): Promise<void>;
  resolve(id: number): Promise<void>;
  /** The newest run recorded from this folder, which is the one to show. */
  latestRun(): Promise<string | null>;
  rememberRun(runId: string): Promise<void>;
  /** Is an agent waiting in this session now? */
  isWaiting(): Promise<boolean>;
  /** True if this token is the one waiting now, whether it just took over or already was. False if another is alive. */
  beat(token: string): Promise<boolean>;
  stopWaiting(token: string): Promise<void>;
  /** What a person has sent that no agent has received. An agent's own replies are never in it. */
  undelivered(): Promise<ReadonlySet<number>>;
  /** Everything sent, up to this message if given, has been received. */
  markDelivered(upTo?: number): Promise<void>;
}

function stateOf(messages: readonly NoteMessage[], resolved: boolean): NoteState {
  if (resolved) return "resolved";
  if (messages[0]?.sent === false) return "draft";
  // A person's draft answer isn't anything yet, so the agent's reply is still what's on the note.
  return messages.filter(({ sent }) => sent).at(-1)?.sender === "agent" ? "replied" : "sent";
}

function requireFound(rows: readonly SqlRow[], id: number): void {
  if (rows.length === 0) throw new SelfieError("unknown-note", `This folder has no note ${id}.`);
}

export function notesIn(sql: Sql, session: string): Notes {
  /** Adds a message, or says this session has no such note. */
  const addMessage = async (id: number, sender: NoteMessage["sender"], author: string, text: string, runId: string | null, sentAt: number) => {
    const at = Date.now();
    const added = await sql.run({
      // A parameter can't be null, so nothing is an empty string or zero on its way in.
      sql: `INSERT INTO note_messages(note_id, sender, author, text, run_id, at, sent_at, delivered_at)
SELECT id, ?3, ?4, ?5, NULLIF(?6, ''), ?7, NULLIF(?8, 0), NULLIF(?8, 0) FROM notes WHERE session = ?1 AND id = ?2 RETURNING id`,
      params: [session, id, sender, author, text, runId ?? "", at, sentAt],
    });
    requireFound(added, id);
  };

  return {
    async list() {
      const [notes, messages] = await Promise.all([
        sql.run({ sql: "SELECT id, story, run_id, image_hash, box, resolved_at FROM notes WHERE session = ?1 ORDER BY id", params: [session], idempotent: true }),
        sql.run({
          sql: `SELECT m.id, m.note_id, m.sender, m.author, m.text, m.run_id, m.at, m.sent_at FROM note_messages m
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
      await sql.run({
        sql: `UPDATE note_messages SET sent_at = ?2 WHERE sent_at IS NULL
  AND note_id IN (SELECT id FROM notes WHERE session = ?1)`,
        params: [session, Date.now()],
      });
    },
    async answer(id, text, author, runId) {
      await addMessage(id, "person", author, text, runId, 0);
      await sql.run({ sql: "UPDATE notes SET resolved_at = NULL WHERE session = ?1 AND id = ?2", params: [session, id] });
    },
    reply: (id, text, runId) => addMessage(id, "agent", "agent", text, runId, Date.now()),
    async resolve(id) {
      const resolved = await sql.run({ sql: "UPDATE notes SET resolved_at = ?3 WHERE session = ?1 AND id = ?2 RETURNING id", params: [session, id, Date.now()] });
      requireFound(resolved, id);
    },
    async latestRun() {
      const [row] = await sql.run({ sql: "SELECT latest_run FROM note_sessions WHERE session = ?1", params: [session], idempotent: true });
      return (row?.latest_run as string | undefined) ?? null;
    },
    async rememberRun(runId) {
      await sql.run({
        sql: `INSERT INTO note_sessions(session, latest_run) VALUES (?1, ?2)
ON CONFLICT(session) DO UPDATE SET latest_run = excluded.latest_run`,
        params: [session, runId],
        idempotent: true,
      });
    },
    async isWaiting() {
      const [row] = await sql.run({ sql: "SELECT heartbeat_at FROM note_waiters WHERE session = ?1", params: [session], idempotent: true });
      return row !== undefined && Date.now() - (row.heartbeat_at as number) < WAITER_STALE_MS;
    },
    async beat(token) {
      const at = Date.now();
      // One statement, so two agents can't both find the place free and both take it.
      const rows = await sql.run({
        sql: `INSERT INTO note_waiters(session, token, heartbeat_at) VALUES (?1, ?2, ?3)
ON CONFLICT(session) DO UPDATE SET token = excluded.token, heartbeat_at = excluded.heartbeat_at
WHERE note_waiters.token = excluded.token OR note_waiters.heartbeat_at <= ?4
RETURNING token`,
        params: [session, token, at, at - WAITER_STALE_MS],
      });
      return rows.length > 0;
    },
    async stopWaiting(token) {
      await sql.run({ sql: "DELETE FROM note_waiters WHERE session = ?1 AND token = ?2", params: [session, token], idempotent: true });
    },
    async undelivered() {
      const rows = await sql.run({
        sql: `SELECT id FROM note_messages WHERE sender = 'person' AND sent_at IS NOT NULL AND delivered_at IS NULL
  AND note_id IN (SELECT id FROM notes WHERE session = ?1)`,
        params: [session],
        idempotent: true,
      });
      return new Set(rows.map(({ id }) => id as number));
    },
    async markDelivered(upTo = Number.MAX_SAFE_INTEGER) {
      await sql.run({
        sql: `UPDATE note_messages SET delivered_at = ?2 WHERE sent_at IS NOT NULL AND delivered_at IS NULL AND id <= ?3
  AND note_id IN (SELECT id FROM notes WHERE session = ?1)`,
        params: [session, Date.now(), upTo],
      });
    },
  };
}

const toMessage = (row: SqlRow): NoteMessage => ({
  id: row.id as number,
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
  state: stateOf(messages, row.resolved_at !== null),
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
  const header = `Feedback on the Storybook stories in the folder \`${folder}\`, as ${notes.length === 1 ? "1 note" : `${notes.length} notes`}. Run \`selfie notes\` there for the details of each, with a picture of what it's about. When you've acted on them, run \`selfie record\`, then \`selfie reply <note> "what you did"\` for each.`;
  const bodies = notes.map(({ id, story, box, messages }) => {
    const said = messages.map(({ sender, text }) => (messages.length === 1 ? text : `${sender === "agent" ? "Agent" : "Person"}: ${text}`)).join("\n\n");
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

/** What's still open for an agent to read, or everything. One at a time, since each may decode a whole image. */
export async function notesForAgent(project: Project, { all = false }: { readonly all?: boolean } = {}): Promise<AgentNotes> {
  const notes = [];
  for (const note of sentNotes(await project.notes.list())) {
    if (all || isOpenNote(note)) notes.push({ ...note, image: await exportNoteImage(project, note) });
  }
  return { folder: project.repo.root, notes };
}

export interface AgentNotes {
  readonly folder: string;
  readonly notes: readonly (Note & { readonly image: string | null })[];
}

/** The notes with something new in them, whole, so an agent has the conversation, with what's new marked. */
async function newNotesForAgent(project: Project, fresh: ReadonlySet<number>): Promise<AgentNotes> {
  const notes = [];
  for (const note of sentNotes(await project.notes.list())) {
    if (!note.messages.some(({ id }) => fresh.has(id))) continue;
    notes.push({ ...note, messages: note.messages.map((message) => ({ ...message, new: fresh.has(message.id) })), image: await exportNoteImage(project, note) });
  }
  return { folder: project.repo.root, notes };
}

/**
 * Blocks until a person sends notes in this session, or something stops it. Nothing counts as
 * received until it's ready to print, so a failure along the way leaves it for the next one.
 */
export async function awaitFeedback(
  project: Project,
  { timeoutMs, signal }: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined },
): Promise<AgentNotes & { readonly outcome: "notes" | "timed-out" | "stopped" }> {
  const { notes } = project;
  const token = randomUUID();
  const nothing = (outcome: "timed-out" | "stopped") => ({ outcome, folder: project.repo.root, notes: [] });
  const deadline = Date.now() + timeoutMs;
  let beaten = Date.now();
  if (!(await notes.beat(token))) throw new SelfieError("already-waiting", "An agent is already waiting for feedback in this folder.");
  try {
    for (;;) {
      if (signal?.aborted) return nothing("stopped");
      const fresh = await notes.undelivered();
      if (fresh.size > 0) {
        const found = await newNotesForAgent(project, fresh);
        await notes.markDelivered(Math.max(...fresh));
        return { outcome: "notes", ...found };
      }
      if (Date.now() >= deadline) return nothing("timed-out");
      await delay(WAITER_POLL_MS, undefined, { signal }).catch(() => undefined);
      if (Date.now() - beaten < WAITER_BEAT_MS) continue;
      beaten = Date.now();
      if (!(await notes.beat(token))) throw new SelfieError("already-waiting", "Another agent took over waiting for feedback in this folder.");
    }
  } finally {
    await notes.stopWaiting(token);
  }
}
