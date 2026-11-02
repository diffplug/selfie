import { readFile } from "node:fs/promises";
import path from "node:path";

export class RenderError extends Error {
  override name = "RenderError";
}

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
}

/** The stories in a build's `index.json`, sorted by ID. Docs entries are left out. */
export async function readStoryIndex(storybookDir: string): Promise<StoryEntry[]> {
  const file = path.join(storybookDir, "index.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new RenderError(
      `Can't read a Storybook index at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (entries === null || typeof entries !== "object")
    throw new RenderError(`${file} has no "entries" object. Selfie needs Storybook 7 or later.`);
  const stories: StoryEntry[] = [];
  for (const entry of Object.values(entries as Record<string, Partial<StoryEntry> & { type?: string }>)) {
    if (entry.type === "story" && typeof entry.id === "string") {
      stories.push({ id: entry.id, title: entry.title ?? "", name: entry.name ?? "" });
    }
  }
  return stories.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Keeps the stories whose ID matches a pattern, where `*` matches any run of characters.
 * `unmatched` lists the patterns that matched nothing, so a typo doesn't look like a pass.
 */
export function filterStories<Story extends { id: string }>(
  stories: readonly Story[],
  patterns: readonly string[],
): { stories: Story[]; unmatched: string[] } {
  const matchers = patterns.map((pattern) => ({
    pattern,
    regex: new RegExp(`^${pattern.split("*").map(RegExp.escape).join(".*")}$`),
  }));
  return {
    stories: stories.filter((story) => matchers.some(({ regex }) => regex.test(story.id))),
    unmatched: matchers
      .filter(({ regex }) => !stories.some((story) => regex.test(story.id)))
      .map(({ pattern }) => pattern),
  };
}
