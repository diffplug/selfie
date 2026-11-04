import { describe, expect, test } from "vitest";
import type { ListedStory } from "../src/shared/api.ts";
import { navigationThrough } from "../src/client/filter.ts";
import { buildStoryTree, differingStories, inTreeOrder, initiallyClosed, nameFromId, isSection, openedAround, storiesIn, visibleRows, type StoryFolder } from "../src/client/storyTree.ts";

const story = (title: string, name: string): ListedStory => ({ story: `${title}--${name}`.toLowerCase(), title, name, render: null });
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

test("names a story from its ID when nothing else says", () => {
  expect(nameFromId("screens-accept--ready-now")).toEqual({ title: "Screens Accept", name: "Ready Now" });
  expect(nameFromId("plain")).toEqual({ title: "", name: "Plain" });
});

describe("a batch's differences", () => {
  const row = (story: string, state: string) => ({ story, state, decision: null }) as never;
  const batch = { id: "r", startedAt: 1 } as never;
  const stories = (rows: never[], storyNames: never[] = [], renames: ReadonlyMap<string, string> = new Map()) => differingStories({ batch, rows, storyNames }, renames).map(({ story }) => story);

  test("are in the Storybook's order, then by ID where it doesn't say", () => {
    const named = [{ story: "z", title: "Z", name: "Z" }, { story: "m", title: "M", name: "M" }] as never[];
    expect(stories([row("a", "changed"), row("m", "changed"), row("z", "changed")], named)).toEqual(["z", "m", "a"]);
  });

  test("have a renamed story once, under its new name", () => {
    expect(stories([row("added", "added"), row("old", "removed")], [], new Map([["added", "old"]]))).toEqual(["added"]);
    expect(stories([row("old", "removed")], [], new Map([["added", "old"]]))).toEqual(["old"]);
  });
});

test("reads from the top of the tree, where a later story joins the folder an earlier one made", () => {
  const stories = [story("B", "One"), story("A", "Two"), story("B", "Three")];
  expect(inTreeOrder(stories).map(({ name }) => name)).toEqual(["One", "Three", "Two"]);
});

describe("next and previous", () => {
  const rows = ["a", "b", "c", "d"].map((story) => ({ story }));
  const through = (shown: typeof rows, story: string) => navigationThrough(rows, shown, story, (name) => `/${name}`, "/");

  test("go through what's shown", () => {
    expect(through(rows, "b")).toMatchObject({ previous: "/a", next: "/c", nextStory: "c", position: "2 of 4" });
  });

  test("still have neighbors for a story a decision just took out of the filter", () => {
    expect(through([rows[0]!, rows[2]!], "b")).toMatchObject({ previous: "/a", next: "/c" });
  });
});
