import { expect, test } from "vitest";
import { applyFilter, decisionTargets, filterQuery, neighbors, NO_FILTER, parseFilter } from "../src/client/filter.ts";
import type { SnapshotRow } from "../src/shared/api.ts";

const row = (story: string, overrides: Partial<SnapshotRow> = {}): SnapshotRow => ({
  story,
  state: "changed",
  imageHash: "a".repeat(64),
  goldenHash: "b".repeat(64),
  failure: null,
  unstable: null,
  playError: null,
  decision: null,
  pixelDiff: null,
  ...overrides,
});

const approved = { decision: "approved", actor: "me", at: 1 } as const;
const stories = (rows: readonly SnapshotRow[]) => rows.map(({ story }) => story);

const rows = [
  row("button--large"),
  row("button--small", { decision: approved }),
  row("card--new", { state: "new", goldenHash: null }),
  row("gone", { state: "removed", imageHash: null }),
  row("broken", { state: "failed", imageHash: null, goldenHash: null, failure: "boom" }),
  row("calm", { state: "unchanged", playError: "threw" }),
];

test("each option shows what it names", () => {
  const show = (value: Parameters<typeof applyFilter>[1]["show"]) => stories(applyFilter(rows, { text: "", show: value }));
  expect(show("undecided")).toEqual(["button--large", "card--new"]);
  expect(show("approved")).toEqual(["button--small"]);
  expect(show("removed")).toEqual(["gone"]);
  expect(show("failed")).toEqual(["broken"]);
  expect(show("advisory")).toEqual(["calm"]);
  expect(show("all")).toHaveLength(rows.length);
});

test("every word must appear, in any order, ignoring case", () => {
  expect(stories(applyFilter(rows, { text: "LARGE button", show: "all" }))).toEqual(["button--large"]);
  expect(applyFilter(rows, { text: "button nothing", show: "all" })).toEqual([]);
});

test("a bulk decision targets only what has an image to decide on", () => {
  expect(decisionTargets(rows).map(({ story }) => story)).toEqual(["button--large", "button--small", "card--new"]);
});

test("neighbors skip what's filtered out, and survive the current story leaving the filter", () => {
  const shown = applyFilter(rows, { text: "", show: "undecided" });
  expect(neighbors(rows, shown, "button--large")).toEqual({ previous: null, next: shown[1] });
  // Approved a moment ago, so no longer shown, and next still means the one after it.
  expect(neighbors(rows, shown, "button--small")).toEqual({ previous: shown[0], next: shown[1] });
  expect(neighbors(rows, shown, "card--new")).toEqual({ previous: shown[0], next: null });
});

test("a filter survives the URL, and a bad one falls back", () => {
  expect(filterQuery(NO_FILTER)).toBe("");
  expect(parseFilter(filterQuery({ text: "a b&c", show: "rejected" }))).toEqual({ text: "a b&c", show: "rejected" });
  expect(parseFilter("?show=nonsense")).toEqual(NO_FILTER);
});
