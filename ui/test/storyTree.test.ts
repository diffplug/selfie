import { expect, test } from "vitest";
import type { ListedStory } from "../src/shared/api.ts";
import { buildStoryTree, initiallyClosed, isSection, openedAround, storiesIn, visibleRows, type StoryFolder } from "../src/client/storyTree.ts";

const story = (title: string, name: string): ListedStory => ({ story: `${title}--${name}`.toLowerCase(), title, name, capture: null });
const labels = (nodes: ReturnType<typeof visibleRows>) => nodes.map((row) => `${" ".repeat(row.depth)}${row.kind === "folder" ? row.name : row.entry.name}`);

const STORIES = [story("Screens/Accept", "Ready"), story("Screens/Accept", "Dark"), story("Screens/Run", "Empty"), story("Alone", "One"), story("A/B/C", "Deep")];

test("nests by title, keeping the Storybook's order", () => {
  expect(labels(visibleRows(buildStoryTree(STORIES), new Set()))).toEqual(["Screens", " Accept", "  Ready", "  Dark", " Run", "  Empty", "Alone", " One", "A", " B", "  C", "   Deep"]);
});

test("puts a later story in the folder an earlier one made, where that folder first came", () => {
  const tree = buildStoryTree([story("B", "One"), story("A", "Two"), story("B", "Three")]);
  expect(labels(visibleRows(tree, new Set()))).toEqual(["B", " One", " Three", "A", " Two"]);
});

test("a story with no title sits at the top", () => {
  expect(labels(visibleRows(buildStoryTree([story("", "Plain")]), new Set()))).toEqual(["Plain"]);
});

test("a closed folder hides what's inside it, however deep, and stays itself", () => {
  const tree = buildStoryTree(STORIES);
  expect(labels(visibleRows(tree, new Set(["Screens/Accept"])))).toEqual(["Screens", " Accept", " Run", "  Empty", "Alone", " One", "A", " B", "  C", "   Deep"]);
  expect(labels(visibleRows(tree, new Set(["Screens"])))).toEqual(["Screens", "Alone", " One", "A", " B", "  C", "   Deep"]);
});

test("counts what's inside a folder, however deep", () => {
  const [screens] = buildStoryTree(STORIES) as StoryFolder[];
  expect(storiesIn(screens!).map(({ name }) => name)).toEqual(["Ready", "Dark", "Empty"]);
});

test("only a top-level folder of folders is a section", () => {
  const [screens, alone, deep] = buildStoryTree(STORIES) as StoryFolder[];
  expect(isSection(screens!, 0)).toBe(true);
  expect(isSection(alone!, 0)).toBe(false);
  expect(isSection(deep!, 1)).toBe(false);
});

test("starts with only the top-level sections open, as Storybook does", () => {
  const tree = buildStoryTree([story("Screens/Accept", "Ready"), story("Screens/Run", "Empty"), story("Alone", "One")]);
  expect(labels(visibleRows(tree, new Set(initiallyClosed(tree))))).toEqual(["Screens", " Accept", " Run", "Alone"]);
});

test("opens the way to a story, and leaves the rest as they were", () => {
  const closed = new Set(["A", "A/B", "A/B/C", "D"]);
  expect([...openedAround(closed, story("A/B", "One"))]).toEqual(["A/B/C", "D"]);
  expect(openedAround(closed, undefined)).toBe(closed);
});
