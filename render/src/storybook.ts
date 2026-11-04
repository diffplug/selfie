import { readFile } from "node:fs/promises";
import path from "node:path";
import { filterStories, storyEntriesIn, type StoryEntry } from "selfie-store";

export class RenderError extends Error {
  override name = "RenderError";
}

export type { StoryEntry };

/** The stories in a build's `index.json`, sorted by ID. Docs entries are left out. */
export async function readStoryIndex(storybookDir: string): Promise<StoryEntry[]> {
  return (await readStoriesInOrder(storybookDir)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The same, in the order the build lists them, which is the order its sidebar shows. */
export async function readStoriesInOrder(storybookDir: string): Promise<StoryEntry[]> {
  const file = path.join(storybookDir, "index.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new RenderError(
      `Can't read a Storybook index at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return storiesInIndex(parsed, file);
}

/** The stories in a parsed `index.json`, in its order. `file` says where it's from, for an error. */
export function storiesInIndex(parsed: unknown, file: string): StoryEntry[] {
  const stories = storyEntriesIn(parsed);
  if (stories === null) throw new RenderError(`${file} has no "entries" object. Selfie needs Storybook 7 or later.`);
  return stories;
}

export const unmatchedPatternWarning = (pattern: string) => `Story pattern "${pattern}" matched nothing.`;

export { filterStories };
