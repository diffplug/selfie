import { describe, expect, test } from "vitest";
import type { ChangedHunk, PixelDiff, RenderRow } from "../src/shared/api.ts";
import { type Comparable, type Delta, acceptedDeltas, canApply, finishedBy, hunksAccepted, MIN_AFFECTED, offeredDeltas, patchGolden, repeatedSizes, type ScannedRow } from "../src/shared/deltas.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const hunk = (golden: ChangedHunk["golden"], current: ChangedHunk["current"], changedPixels = 1): ChangedHunk => ({ golden, current, kind: "changed", changedPixels, moved: [] });

const diffOf = (hunks: readonly ChangedHunk[], golden = { width: 100, height: 200 }, current = golden): PixelDiff => ({
  golden,
  current,
  hunks,
  changedPixels: hunks.reduce((sum, { changedPixels }) => sum + changedPixels, 0),
  movedPixels: 0,
  spacingPixels: 0,
  totalPixels: 20_000,
  boundingBox: null,
  firstChanged: null,
  maxChannelDelta: 9,
});

const scan = (story: string, keys: readonly (string | null)[], decision: RenderRow["decision"] = null): ScannedRow => ({
  row: { story, state: "changed", imageHash: `${story}-now`, goldenHash: `${story}-was`, failure: null, decision, pixelDiff: null, goldenStorybookUrl: null, goldenViewport: null } as Comparable,
  diff: diffOf(keys.map((_, index) => hunk(box(0, index * 10, 4, 4), box(0, index * 10, 4, 4)))),
  keys,
});

const storiesOf = (examples: Delta["examples"]) => examples.map(({ story }) => story);

const approved = { decision: "approved", actor: "a", at: 1 } as const;
const rejected = { decision: "rejected", actor: "a", at: 1 } as const;

describe("canApply", () => {
  test("takes a hunk of one size anywhere, and one that changes height only across the whole image", () => {
    const diff = diffOf([]);
    expect(canApply(hunk(box(5, 5, 4, 4), box(5, 20, 4, 4)), diff)).toBe(true);
    expect(canApply(hunk(box(0, 5, 100, 4), box(0, 5, 100, 9)), diff)).toBe(true);
    expect(canApply(hunk(box(0, 5, 100, 15), box(0, 20, 100, 0)), diff)).toBe(true);
    expect(canApply(hunk(box(5, 5, 4, 4), box(5, 5, 4, 9)), diff)).toBe(false);
  });
});

describe("repeatedSizes", () => {
  test("counts a story once, however often it has that size", () => {
    const twice = diffOf([hunk(box(0, 0, 4, 4), box(0, 0, 4, 4)), hunk(box(0, 9, 4, 4), box(0, 9, 4, 4))]);
    expect(repeatedSizes([twice, twice])).toEqual(new Set());
    expect(repeatedSizes(Array.from({ length: MIN_AFFECTED }, () => twice))).toEqual(new Set(["4x4>4x4"]));
  });

  test("leaves out what can't be applied", () => {
    const narrow = diffOf([hunk(box(5, 5, 4, 4), box(5, 5, 4, 9))]);
    expect(repeatedSizes([narrow, narrow, narrow])).toEqual(new Set());
  });
});

describe("offeredDeltas", () => {
  test("offers only what enough stories share, most stories first", () => {
    const scans = [scan("a", ["x", "y"]), scan("b", ["x", "y"]), scan("c", ["x", "y"]), scan("d", ["x"]), scan("e", ["z"]), scan("f", ["z"])];
    expect(offeredDeltas(scans, new Set()).map(({ key, examples }) => [key, storiesOf(examples)])).toEqual([
      ["x", ["a", "b", "c", "d"]],
      ["y", ["a", "b", "c"]],
    ]);
  });

  test("counts a story once when it has a delta twice", () => {
    expect(offeredDeltas([scan("a", ["x", "x"]), scan("b", ["x"])], new Set())).toEqual([]);
  });

  test("never counts an image that has a decision, or offers what's accepted", () => {
    const scans = [scan("a", ["x"]), scan("b", ["x"]), scan("c", ["x"], approved), scan("d", ["x"], rejected)];
    expect(offeredDeltas(scans, new Set())).toEqual([]);
    expect(offeredDeltas([...scans, scan("e", ["x"])], new Set(["x"]))).toEqual([]);
    expect(offeredDeltas([...scans, scan("e", ["x"])], new Set()).map(({ examples }) => storiesOf(examples))).toEqual([["a", "b", "e"]]);
  });

  test("says where each story has it, which may be different in each", () => {
    const at = (story: string, y: number): ScannedRow => {
      const placed = scan(story, ["x"]);
      return { ...placed, diff: diffOf([hunk(box(0, y, 4, 4), box(0, y + 15, 4, 4))]) };
    };
    const [delta] = offeredDeltas([at("a", 10), at("b", 40), at("c", 70)], new Set());
    expect(delta?.examples.map(({ story, golden, current }) => [story, golden.hash, golden.boxes[0]?.y, current.hash, current.boxes[0]?.y])).toEqual([
      ["a", "a-was", 10, "a-now", 25],
      ["b", "b-was", 40, "b-now", 55],
      ["c", "c-was", 70, "c-now", 85],
    ]);
  });

  test("gives every place a story has it, and counts that story once", () => {
    const twice: ScannedRow = { ...scan("a", ["x", "x"]), diff: diffOf([hunk(box(0, 10, 4, 4), box(0, 10, 4, 4)), hunk(box(0, 90, 4, 4), box(0, 90, 4, 4))]) };
    const [delta] = offeredDeltas([twice, scan("b", ["x"]), scan("c", ["x"])], new Set());
    expect(delta?.examples[0]?.golden.boxes.map(({ y }) => y)).toEqual([10, 90]);
    expect(delta?.examples).toHaveLength(3);
  });

  test("never offers a hunk that can't be applied", () => {
    expect(offeredDeltas([scan("a", [null]), scan("b", [null]), scan("c", [null])], new Set())).toEqual([]);
  });
});

test("acceptedDeltas lists every story, whatever's been decided since", () => {
  const scans = [scan("a", ["x"], approved), scan("b", ["x"]), scan("c", ["y"])];
  expect(acceptedDeltas(scans, new Set(["x"])).map(({ examples }) => storiesOf(examples))).toEqual([["a", "b"]]);
});

describe("finishedBy", () => {
  test("is only the undecided images with nothing left", () => {
    const scans = [scan("a", ["x"]), scan("b", ["x", "y"]), scan("c", ["x", null]), scan("d", ["x"], rejected), scan("e", ["x"], approved)];
    expect(finishedBy(scans, new Set(["x"])).map(({ story }) => story)).toEqual(["a"]);
    expect(finishedBy(scans, new Set(["x", "y"])).map(({ story }) => story)).toEqual(["a", "b"]);
  });
});

test("hunksAccepted says which of a story's hunks", () => {
  expect(hunksAccepted(["x", null, "y", "x"], new Set(["x"]))).toEqual([0, 3]);
});

describe("patchGolden", () => {
  const header = hunk(box(0, 8, 100, 20), box(0, 8, 100, 35), 500);
  const narrow = hunk(box(40, 100, 4, 4), box(40, 115, 4, 4), 3);
  const gap = { ...hunk(box(0, 150, 100, 15), box(0, 165, 100, 0), 0), kind: "spacing" as const };
  const diff = diffOf([header, narrow, gap]);

  test("accepting nothing is the golden", () => {
    const { blits, diff: left } = patchGolden(diff, []);
    expect(left.golden).toEqual(diff.golden);
    expect(blits).toEqual([{ from: "golden", box: box(0, 0, 100, 200), toX: 0, toY: 0 }]);
    expect(left.hunks).toEqual(diff.hunks);
  });

  test("makes room for what grew, and moves what's left down with it", () => {
    const { blits, diff: left, settled } = patchGolden(diff, [0]);
    expect(blits).toEqual([
      { from: "golden", box: box(0, 0, 100, 8), toX: 0, toY: 0 },
      { from: "current", box: box(0, 8, 100, 35), toX: 0, toY: 8 },
      { from: "golden", box: box(0, 28, 100, 172), toX: 0, toY: 43 },
    ]);
    expect(left.hunks.map(({ golden }) => golden)).toEqual([box(40, 115, 4, 4), box(0, 165, 100, 15)]);
    expect(left.hunks.map(({ current }) => current)).toEqual([narrow.current, gap.current]);
    expect(left.golden).toEqual({ width: 100, height: 215 });
    expect(left.changedPixels).toBe(3);
    expect(left.spacingPixels).toBe(1500);
    expect(left.firstChanged).toEqual({ x: 40, y: 115 });
    expect(settled).toEqual([header.current]);
  });

  test("puts a hunk of one size where the golden has it, as moved by what's above it", () => {
    const { blits } = patchGolden(diff, [0, 1]);
    expect(blits.at(-1)).toEqual({ from: "current", box: narrow.current, toX: 40, toY: 115 });
  });

  test("takes out what's gone, and marks the seam it left as settled", () => {
    const { blits, settled, diff: left } = patchGolden(diff, [2]);
    expect(left.golden.height).toBe(185);
    expect(blits).toEqual([
      { from: "golden", box: box(0, 0, 100, 150), toX: 0, toY: 0 },
      { from: "golden", box: box(0, 165, 100, 35), toX: 0, toY: 150 },
    ]);
    expect(settled).toEqual([box(0, 165, 100, 1)]);
  });

  test("gives no bounding box or first change with nothing left", () => {
    const { diff: left } = patchGolden(diff, [0, 1, 2]);
    expect(left).toMatchObject({ hunks: [], changedPixels: 0, movedPixels: 0, spacingPixels: 0, boundingBox: null, firstChanged: null, maxChannelDelta: 0 });
    expect(left.golden).toEqual(left.current);
  });

  test("takes on the current image's width when a hunk is the whole of two widths", () => {
    const whole = diffOf([hunk(box(0, 0, 100, 200), box(0, 0, 80, 200))], { width: 100, height: 200 }, { width: 80, height: 200 });
    const { blits, diff: left } = patchGolden(whole, [0]);
    expect(left.golden).toEqual({ width: 80, height: 200 });
    expect(blits).toEqual([{ from: "current", box: box(0, 0, 80, 200), toX: 0, toY: 0 }]);
  });
});
