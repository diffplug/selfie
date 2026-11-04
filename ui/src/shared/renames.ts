import type { ComparedRender } from "./api.ts";

// A story that's gone and a new one with the very same image read as one story renamed. Only for
// saying so: to the store they're still one removed and one added, each with a decision of its own.

type ComparedRow = Pick<ComparedRender, "story" | "state" | "imageHash" | "goldenHash">;

const wordsOf = (story: string) => new Set(story.split(/-+/));

/** How many words two story IDs share, which picks between stories that all render the same image. */
function closeness(a: string, b: string): number {
  const theirs = wordsOf(b);
  return [...wordsOf(a)].filter((word) => theirs.has(word)).length;
}

/** Each added story that took over from a removed one, with what it was, one to one. */
export function findRenames(rows: readonly ComparedRow[]): ReadonlyMap<string, string> {
  const removedByImage = new Map<string, string[]>();
  for (const { state, story, goldenHash } of rows) {
    if (state === "removed" && goldenHash !== null) removedByImage.set(goldenHash, [...(removedByImage.get(goldenHash) ?? []), story]);
  }
  const candidates = rows.flatMap(({ state, story, imageHash }) =>
    state !== "added" || imageHash === null ? [] : (removedByImage.get(imageHash) ?? []).map((from) => ({ to: story, from, closeness: closeness(story, from) })),
  );
  // Closest first, then by name, so the same rows always pair the same way.
  candidates.sort((a, b) => b.closeness - a.closeness || a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
  const renames = new Map<string, string>();
  const taken = new Set<string>();
  for (const { to, from } of candidates) {
    if (renames.has(to) || taken.has(from)) continue;
    renames.set(to, from);
    taken.add(from);
  }
  return renames;
}
