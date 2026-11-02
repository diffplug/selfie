import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { filterStories, readStoryIndex, RenderError } from "../src/storybook.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/storybook", import.meta.url));

describe("readStoryIndex", () => {
  test("reads stories sorted by ID, without docs", async () => {
    const stories = await readStoryIndex(FIXTURE);
    expect(stories.map((story) => story.id)).toEqual([...stories.map((story) => story.id)].sort());
    expect(stories.map((story) => story.id)).not.toContain("guide--docs");
    expect(stories).toContainEqual({ id: "basic--detail", title: "Basic", name: "Detail" });
  });

  test("throws a RenderError for a directory with no index", async () => {
    await expect(readStoryIndex(path.join(FIXTURE, "missing"))).rejects.toThrow(RenderError);
  });
});

describe("filterStories", () => {
  const stories = ["a--one", "a--two", "b--one"].map((id) => ({ id, title: "", name: "" }));
  const ids = (patterns: string[]) => filterStories(stories, patterns).stories.map((story) => story.id);

  test("matches exact IDs and wildcards, and only whole IDs", () => {
    expect(ids(["a--one"])).toEqual(["a--one"]);
    expect(ids(["a--*"])).toEqual(["a--one", "a--two"]);
    expect(ids(["*--one"])).toEqual(["a--one", "b--one"]);
    expect(ids(["a--"])).toEqual([]);
  });

  test("treats regex characters literally", () => {
    expect(ids(["a.-one"])).toEqual([]);
    expect(ids(["(a)--one"])).toEqual([]);
  });

  test("reports a pattern that matched nothing", () => {
    expect(filterStories(stories, ["a--one", "nope"]).unmatched).toEqual(["nope"]);
  });
});
