// Stories as Storybook's own sidebar nests them, by the path in each one's title. Pure, so a test
// needs no browser.
import type { ListedStory } from "../shared/api.ts";

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

/** A row to draw: how deep it is, and whether something's holding it closed. */
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
export const storiesIn = ({ children }: StoryFolder): readonly ListedStory[] =>
  children.flatMap((child) => (child.kind === "story" ? [child.entry] : storiesIn(child)));

/** Whether a folder only groups other folders, as a sidebar's top-level sections do. */
export const isSection = ({ children }: StoryFolder, depth: number) => depth === 0 && children.every((child) => child.kind === "folder");
