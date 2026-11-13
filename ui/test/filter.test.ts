import { describe, expect, test } from "vitest";
import { applyFilter, decidableIn, filterQuery, neighbors, NO_FILTER, parseFilter, reuseRows, rowsFor, showQuery, decisionRowOf, inheritedFrom, withDecisionsOf } from "../src/client/filter.ts";
import type { ApprovedRow, RenderRow, SinceBaseRow } from "../src/shared/api.ts";

const row = (story: string, overrides: Partial<RenderRow> = {}): RenderRow => ({
  story,
  state: "changed",
  imageHash: "a".repeat(64),
  goldenHash: "b".repeat(64),
  failure: null,
  decision: null,
  goldenStorybookUrl: null,
  goldenViewport: null,
  pixelDiff: null,
  ...overrides,
});

const approved = { decision: "approved", actor: "me", at: 1 } as const;
const stories = (rows: readonly RenderRow[]) => rows.map(({ story }) => story);

const rows = [
  row("button--large"),
  row("button--small", { decision: approved }),
  row("card--new", { state: "added", goldenHash: null }),
  row("gone", { state: "removed", imageHash: null }),
  row("broken", { state: "failed", imageHash: null, goldenHash: null, failure: "boom" }),
];

test("each option shows what it names", () => {
  const show = (value: Parameters<typeof applyFilter>[1]["show"]) => stories(applyFilter(rows, { text: "", show: value }));
  expect(show("undecided")).toEqual(["button--large", "card--new", "gone"]);
  expect(show("approved")).toEqual(["button--small"]);
  expect(show("removed")).toEqual(["gone"]);
  expect(show("failed")).toEqual(["broken"]);
  expect(show("all")).toHaveLength(rows.length);
});

test("every word must appear, in any order, ignoring case", () => {
  expect(stories(applyFilter(rows, { text: "LARGE button", show: "all" }))).toEqual(["button--large"]);
  expect(applyFilter(rows, { text: "button nothing", show: "all" })).toEqual([]);
});

test("a bulk decision targets only what can take a decision, which a removal can", () => {
  expect(stories(decidableIn(rows))).toEqual(["button--large", "button--small", "card--new", "gone"]);
});

test("neighbors skip what's filtered out, and survive the current story leaving the filter", () => {
  const shown = applyFilter(rows, { text: "", show: "undecided" });
  expect(neighbors(rows, shown, "button--large")).toEqual({ previous: null, next: shown[1] });
  // Approved a moment ago, so no longer shown, and next still means the one after it.
  expect(neighbors(rows, shown, "button--small")).toEqual({ previous: shown[0], next: shown[1] });
  expect(neighbors(rows, shown, "card--new")).toEqual({ previous: shown[0], next: shown[2] });
  expect(neighbors(rows, shown, "gone")).toEqual({ previous: shown[1], next: null });
});

test("a read keeps the objects of rows it didn't change, so only a changed row re-renders", () => {
  const next = rows.map((row) => ({ ...row }));
  next[0] = { ...next[0]!, decision: approved };
  next[1] = { ...next[1]!, decision: { ...approved, at: 2 } };
  const kept = reuseRows(rows, [...next, row("appeared")]);
  expect(kept[0]).toBe(next[0]);
  expect(kept[1]).toBe(next[1]);
  expect(kept.slice(2, rows.length)).toEqual(rows.slice(2));
  kept.slice(2, rows.length).forEach((same, index) => expect(same).toBe(rows[index + 2]));
  expect(kept[rows.length]!.story).toBe("appeared");
});

test("a filter survives the URL, and a bad one falls back", () => {
  expect(showQuery("failed")).toBe("?show=failed");
  expect(filterQuery(NO_FILTER)).toBe("");
  expect(parseFilter(filterQuery({ text: "a b&c", show: "rejected" }))).toEqual({ text: "a b&c", show: "rejected" });
  expect(parseFilter("?show=nonsense")).toEqual(NO_FILTER);
});

test("moved and spacing only is a changed row with nothing changed in it", () => {
  const stats = (changedPixels: number) => ({ changedPixels, hunks: [{ changedPixels }] }) as unknown as RenderRow["pixelDiff"];
  const candidates = [
    row("only-moved", { pixelDiff: stats(0) }),
    row("really-changed", { pixelDiff: stats(1) }),
    row("not-compared-yet"),
    row("new-story", { state: "added", goldenHash: null, pixelDiff: stats(0) }),
  ];
  expect(stories(applyFilter(candidates, { text: "", show: "layout" }))).toEqual(["only-moved"]);
  expect(parseFilter("?show=layout").show).toBe("layout");
});

test("what's read separately is null until it's been read, and otherwise a Show picks from what differs", () => {
  const differs = { story: "differs", state: "changed", decision: null } as RenderRow;
  const earlier = { story: "earlier", state: "changed", decision: { decision: "approved", actor: "a", at: 1 }, approvedIn: "elsewhere" } as ApprovedRow;
  const read = { unchanged: null, approvedSince: { base: null, rows: [earlier] }, sinceBase: null };
  expect(rowsFor("all", [differs], read)).toEqual([differs]);
  expect(rowsFor("unchanged", [differs], read)).toBeNull();
  expect(rowsFor("approved-earlier", [differs], read)).toEqual([earlier]);
  expect(rowsFor("approved-earlier", [differs], { unchanged: null, approvedSince: null, sinceBase: null })).toBeNull();
  expect(applyFilter([earlier], { text: "", show: "approved-earlier" })).toEqual([earlier]);
  expect(rowsFor("since-base", [differs], read)).toBeNull();
  expect(rowsFor("since-base", [differs], { ...read, sinceBase: { base: null, rows: [{ ...earlier, approvedIn: null }] } })).toHaveLength(1);
});

describe("what's changed since a base", () => {
  const own = { story: "own", state: "changed", imageHash: "h2", goldenHash: "h1", decision: null } as RenderRow;
  const inherited = { story: "inherited", state: "added", imageHash: "h3", goldenHash: null, decision: null } as RenderRow;
  const sinceOwn = { ...own, goldenHash: "h0", approvedIn: null } as SinceBaseRow;
  const earlier = { story: "earlier", state: "changed", imageHash: "h5", goldenHash: "h4", decision: { decision: "approved", actor: "a", at: 1 }, approvedIn: "b" } as SinceBaseRow;

  test("decides on the batch's own row for the very same image, and on nothing else", () => {
    expect(decisionRowOf(sinceOwn, [own, inherited])).toBe(own);
    expect(decisionRowOf({ ...sinceOwn, imageHash: "other" }, [own])).toBeNull();
    expect(decisionRowOf(earlier, [own, inherited])).toBeNull();
  });

  test("takes each decision from the batch's own rows, so deciding shows at once", () => {
    const decided = { ...own, decision: { decision: "approved", actor: "a", at: 2 } } as RenderRow;
    const [updated, untouched] = withDecisionsOf([sinceOwn, earlier], [decided]);
    expect(updated!.decision?.decision).toBe("approved");
    expect(untouched).toBe(earlier);
    expect(withDecisionsOf([sinceOwn], [own])[0]).toBe(sinceOwn);
  });

  test("calls inherited what differs from what's approved and not from the base", () => {
    expect(inheritedFrom({ base: {}, rows: [sinceOwn] }, [own, inherited])).toEqual([inherited]);
    expect(inheritedFrom({ base: null, rows: [] }, [own, inherited])).toBeNull();
  });
});
