// Stories as Storybook's own sidebar nests them, by the path in each one's title. Pure, so a test
// needs no browser.
import type { ListedStory, RunView } from "../shared/api.ts";

export interface StoryFolder {
  readonly kind: "folder";
  readonly name: string;
  /** The whole path, which is what makes a folder itself. */
  readonly path: string;
  readonly children: readonly StoryTreeNode[];
}

export interface StoryLeaf {
  readonly kind: "story";
  readonly entry: ListedStory;
}

export type StoryTreeNode = StoryFolder | StoryLeaf;

/** A row to draw, and how deep it is. */
export type StoryTreeRow = StoryTreeNode & { readonly depth: number };

/** Keeps the Storybook's order, where a folder comes where its first story does. */
export function buildStoryTree(stories: readonly ListedStory[]): readonly StoryTreeNode[] {
  interface Building {
    readonly kind: "folder";
    readonly name: string;
    readonly path: string;
    readonly children: (Building | StoryLeaf)[];
  }
  const root: Building = { kind: "folder", name: "", path: "", children: [] };
  const folders = new Map<string, Building>();
  for (const entry of stories) {
    let at = root;
    for (const name of entry.title.split("/").filter(Boolean)) {
      const path = at.path === "" ? name : `${at.path}/${name}`;
      let next = folders.get(path);
      if (next === undefined) {
        next = { kind: "folder", name, path, children: [] };
        folders.set(path, next);
        at.children.push(next);
      }
      at = next;
    }
    at.children.push({ kind: "story", entry });
  }
  return root.children;
}

/** The rows to draw, leaving out what's inside a closed folder. */
export function visibleRows(nodes: readonly StoryTreeNode[], closed: ReadonlySet<string>, depth = 0): StoryTreeRow[] {
  return nodes.flatMap((node): StoryTreeRow[] => {
    const row = { ...node, depth };
    if (node.kind === "story" || closed.has(node.path)) return [row];
    return [row, ...visibleRows(node.children, closed, depth + 1)];
  });
}

/** Every story inside a folder, however deep. */
export const storiesIn = ({ children }: Pick<StoryFolder, "children">): readonly ListedStory[] =>
  children.flatMap((child) => (child.kind === "story" ? [child.entry] : storiesIn(child)));

/** Whether a folder only groups other folders, as a sidebar's top-level sections do. */
export const isSection = ({ children }: StoryFolder, depth: number) => depth === 0 && children.every((child) => child.kind === "folder");

/** What Storybook's sidebar starts with closed: everything but the top-level sections. */
export function initiallyClosed(nodes: readonly StoryTreeNode[], depth = 0): readonly string[] {
  return nodes.flatMap((node) => {
    if (node.kind === "story") return [];
    return [...(isSection(node, depth) ? [] : [node.path]), ...initiallyClosed(node.children, depth + 1)];
  });
}

/** Closed folders, less the ones a story is in, so it can be seen. */
export function openedAround(closed: ReadonlySet<string>, entry: ListedStory | undefined): ReadonlySet<string> {
  if (entry === undefined) return closed;
  const next = new Set(closed);
  const names = entry.title.split("/").filter(Boolean);
  names.forEach((_, at) => next.delete(names.slice(0, at + 1).join("/")));
  return next;
}

/** What a sidebar would call a story, from its ID alone, for when its built Storybook isn't kept. */
export function nameFromId(story: string): { readonly title: string; readonly name: string } {
  const [path = "", name = ""] = story.split("--");
  const words = (text: string) => text.split("-").filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
  return name === "" ? { title: "", name: words(path) } : { title: words(path), name: words(name) };
}

/** A run's rows as a tree's list, in its Storybook's order, with a renamed story there once, under its new name. */
export function differingStories(
  { run, rows, storyNames }: Pick<RunView, "run" | "rows" | "storyNames">,
  renames: ReadonlyMap<string, string>,
): readonly ListedStory[] {
  // Only if the name it went to is here to say so.
  const hidden = new Set(rows.flatMap(({ story }) => renames.get(story) ?? []));
  const order = new Map(storyNames.map(({ story }, at) => [story, at]));
  const names = new Map(storyNames.map(({ story, title, name }) => [story, { title, name }]));
  const at = (story: string) => order.get(story) ?? order.size;
  return rows
    .filter(({ story }) => !hidden.has(story))
    .sort((a, b) => at(a.story) - at(b.story) || a.story.localeCompare(b.story))
    .map(({ story, state, decision }) => ({
      story,
      ...(names.get(story) ?? nameFromId(story)),
      render: { runId: run.id, state, decision, renderedAt: run.startedAt, dirty: false, fromHostedStorybook: null },
    }));
}

/** Stories in the order a tree of them reads from the top, which is the order next and previous must go in. */
export function inTreeOrder(stories: readonly ListedStory[]): readonly ListedStory[] {
  return storiesIn({ children: buildStoryTree(stories) });
}
