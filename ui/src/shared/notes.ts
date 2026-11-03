// What counts as a note, for the routes, the CLI, and the page alike.
import type { Note } from "./api.ts";

export const MAX_NOTE_CHARACTERS = 10_000;

export const isNoteText = (text: unknown): text is string => typeof text === "string" && text.trim() !== "" && text.length <= MAX_NOTE_CHARACTERS;

export const isNoteId = (id: number) => Number.isSafeInteger(id) && id >= 1;

/** Still something for someone to do. */
export const isOpenNote = ({ state }: Note) => state !== "resolved";
