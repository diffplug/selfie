// Story IDs and a built Storybook's list of them, which any platform can read.

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
}

/** The stories in a parsed `index.json`, in its order, or null if it has no entries. Docs entries are left out. */
export function storyEntriesIn(parsed: unknown): StoryEntry[] | null {
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (entries === null || typeof entries !== "object") return null;
  const stories: StoryEntry[] = [];
  for (const entry of Object.values(entries as Record<string, Partial<StoryEntry> & { type?: string }>)) {
    if (entry.type === "story" && typeof entry.id === "string") {
      stories.push({ id: entry.id, title: entry.title ?? "", name: entry.name ?? "" });
    }
  }
  return stories;
}

const literally = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

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
    regex: new RegExp(`^${pattern.split("*").map(literally).join(".*")}$`),
  }));
  return {
    stories: stories.filter((story) => matchers.some(({ regex }) => regex.test(story.id))),
    unmatched: matchers
      .filter(({ regex }) => !stories.some((story) => regex.test(story.id)))
      .map(({ pattern }) => pattern),
  };
}
