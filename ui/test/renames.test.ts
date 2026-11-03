import { expect, test } from "vitest";
import { findRenames } from "../src/shared/renames.ts";

const added = (story: string, imageHash: string) => ({ story, state: "added" as const, imageHash, goldenHash: null });
const gone = (story: string, goldenHash: string) => ({ story, state: "removed" as const, imageHash: null, goldenHash });
const renamesOf = (...rows: Parameters<typeof findRenames>[0]) => Object.fromEntries(findRenames(rows));

test("a removed story and a new one with the same image are a rename", () => {
  expect(renamesOf(gone("old--a", "x"), added("new--a", "x"))).toEqual({ "new--a": "old--a" });
});

test("a different image isn't, nor is either side alone", () => {
  expect(renamesOf(gone("old--a", "x"), added("new--a", "y"))).toEqual({});
  expect(renamesOf(gone("old--a", "x"))).toEqual({});
  expect(renamesOf(added("new--a", "x"))).toEqual({});
});

test("a changed story with that image isn't", () => {
  expect(renamesOf(gone("old--a", "x"), { story: "b", state: "changed" as const, imageHash: "x", goldenHash: "z" })).toEqual({});
});

test("is one to one, so a second copy of an image reads as new", () => {
  expect(renamesOf(gone("old--a", "x"), added("new--a", "x"), added("new--b", "x"))).toEqual({ "new--a": "old--a" });
});

test("of stories that render the same image, pairs the closest names", () => {
  const rows = [gone("button--primary", "x"), gone("card--empty", "x"), added("widgets-card--empty", "x"), added("widgets-button--primary", "x")];
  expect(renamesOf(...rows)).toEqual({ "widgets-card--empty": "card--empty", "widgets-button--primary": "button--primary" });
});
