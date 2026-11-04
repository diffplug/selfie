// What counts as a note, for the routes, the CLI, and the page alike.
import type { Note } from "./api.ts";

export const MAX_NOTE_CHARACTERS = 10_000;

export const isNoteText = (text: unknown): text is string => typeof text === "string" && text.trim() !== "" && text.length <= MAX_NOTE_CHARACTERS;

export const isNoteId = (id: number) => Number.isSafeInteger(id) && id >= 1;

/** Still something for someone to do. */
export const isOpenNote = ({ state }: Note) => state !== "resolved";

/** The image the newest open note on a story is on, whichever image that was. */
export const newestNotedImage = (notes: readonly Note[], story: string): string | null =>
  notes.filter((note) => note.story === story && isOpenNote(note)).findLast(({ imageHash }) => imageHash !== null)?.imageHash ?? null;

/**
 * What a story's image is compared with: its golden, or with none, the image its newest open note is
 * on, so an agent's change to an added story shows as one. Only to look at: a decision is on the image.
 */
export function comparedImage(
  { imageHash, goldenHash }: { readonly imageHash: string | null; readonly goldenHash: string | null },
  notedImage: string | null,
): { readonly hash: string; readonly layer: "golden" | "noted" } | null {
  if (goldenHash !== null) return { hash: goldenHash, layer: "golden" };
  return imageHash !== null && notedImage !== null && notedImage !== imageHash ? { hash: notedImage, layer: "noted" } : null;
}
