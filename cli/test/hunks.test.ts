// The recursive 9-slice, on images drawn here so each case says exactly what it's about.
import type { RawImage } from "selfie-store";
import { describe, expect, test } from "vitest";
import { diffImages } from "../src/diff.ts";
import { findHunks } from "../src/hunks.ts";

const WIDTH = 40;
const INK = [20, 20, 20];

/** A page, with a row for each line: a blank, or a mark at a column that makes the row distinct. */
function page(lines: readonly (number | null)[], width = WIDTH): RawImage {
  const pixels = new Uint8Array(width * lines.length * 3).fill(255);
  lines.forEach((mark, y) => {
    if (mark !== null) pixels.set(INK, (y * width + mark) * 3);
  });
  return { width, height: lines.length, pixels };
}

/** Distinct rows, so they appear once each. */
const distinct = (count: number, from = 0) => Array.from({ length: count }, (_, i) => (from + i) % WIDTH);

const paint = (image: RawImage, x: number, y: number, width: number, height: number, color = [200, 0, 0]) => {
  const pixels = image.pixels.slice();
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) pixels.set(color, (row * image.width + column) * 3);
  }
  return { ...image, pixels };
};

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("findHunks", () => {
  test("identical images have none", () => {
    const golden = page(distinct(30));
    expect(findHunks(golden, page(distinct(30)))).toEqual([]);
  });

  test("one change is as tight as its pixels", () => {
    const golden = page(distinct(30));
    expect(findHunks(paint(golden, 5, 10, 3, 2), golden)).toEqual([{ current: box(5, 10, 3, 2), golden: box(5, 10, 3, 2) }]);
  });

  test("two changes one above the other are two hunks", () => {
    const golden = page(Array.from({ length: 60 }, () => null));
    const current = paint(paint(golden, 2, 5, 4, 2), 8, 40, 4, 2);
    expect(findHunks(current, golden).map(({ current: here }) => here)).toEqual([box(2, 5, 4, 2), box(8, 40, 4, 2)]);
  });

  test("two changes side by side are two hunks, which rows alone couldn't separate", () => {
    const golden = page(Array.from({ length: 20 }, () => null));
    const current = paint(paint(golden, 1, 5, 3, 3), 30, 5, 3, 3);
    expect(findHunks(current, golden).map(({ current: here }) => here)).toEqual([box(1, 5, 3, 3), box(30, 5, 3, 3)]);
  });

  test("a change above an added row leaves everything after it matched, with no ghost", () => {
    const lines = distinct(30);
    const golden = page(lines);
    const added = page([...lines.slice(0, 20), null, null, null, null, null, ...lines.slice(20)]);
    const current = paint(added, 2, 4, 3, 1);
    const { diff, highlighted } = diffImages(current, golden);
    expect(diff.hunks).toMatchObject([
      { current: box(2, 4, 3, 1), golden: box(2, 4, 3, 1), kind: "changed", changedPixels: 3 },
      { current: box(0, 20, WIDTH, 5), golden: box(0, 20, WIDTH, 0), kind: "spacing", changedPixels: 0 },
    ]);
    // A mark from below the added rows would show here as a ghost if rows weren't lined up.
    const below = highlighted.pixels.subarray(25 * WIDTH * 3);
    expect(below.some((value, at) => at % 3 === 0 && value === 255 && below[at + 1] === 0)).toBe(false);
  });

  test("a removed row in the middle is a hunk with nothing in the current image", () => {
    const lines = distinct(30);
    const golden = page(lines);
    const current = page([...lines.slice(0, 12), ...lines.slice(15)]);
    expect(findHunks(current, golden)).toEqual([{ current: box(0, 12, WIDTH, 0), golden: box(0, 12, WIDTH, 3) }]);
  });

  test("repeated rows aren't anchors, so a row among identical ones stays in place", () => {
    const row = [3, 3, 3, 3, null];
    const lines = Array.from({ length: 6 }, () => row).flat();
    const golden = page(lines);
    const current = paint(golden, 10, 12, 2, 1);
    expect(findHunks(current, golden)).toEqual([{ current: box(10, 12, 2, 1), golden: box(10, 12, 2, 1) }]);
  });

  test("hunks come in reading order, top to bottom and then left to right", () => {
    const golden = page(Array.from({ length: 40 }, () => null));
    const current = paint(paint(paint(golden, 30, 2, 2, 2), 1, 2, 2, 2), 10, 30, 2, 2);
    expect(findHunks(current, golden).map(({ current: here }) => [here.x, here.y])).toEqual([[1, 2], [30, 2], [10, 30]]);
  });

  test("the same two images always give the same hunks", () => {
    const golden = page(distinct(30));
    const current = paint(paint(golden, 1, 5, 3, 3), 30, 20, 3, 3);
    expect(findHunks(current, golden)).toEqual(findHunks(current, golden));
  });

  test("every changed pixel is in a hunk, whatever changed", () => {
    // A fixed sequence, so a failure repeats.
    let seed = 7;
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % below;
    };
    for (let trial = 0; trial < 200; trial++) {
      const golden = page(Array.from({ length: 30 }, () => (next(3) === 0 ? null : next(WIDTH))));
      let current = golden;
      for (let change = next(5); change >= 0; change--) current = paint(current, next(WIDTH - 3), next(27), 1 + next(3), 1 + next(3));
      const hunks = findHunks(current, golden);
      const inHunk = (x: number, y: number) =>
        hunks.some(({ current: r }) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
      for (let y = 0; y < current.height; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const at = (y * WIDTH + x) * 3;
          const same = current.pixels[at] === golden.pixels[at] && current.pixels[at + 1] === golden.pixels[at + 1];
          if (!same && !inHunk(x, y)) throw new Error(`trial ${trial}: pixel ${x}, ${y} changed outside any hunk`);
        }
      }
    }
  });

  test("everything between hunks matches, once lined up", () => {
    let checked = 0;
    let seed = 11;
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % below;
    };
    for (let trial = 0; trial < 100; trial++) {
      const lines = Array.from({ length: 40 }, () => (next(4) === 0 ? null : next(WIDTH)));
      const at = next(30);
      const edited = [...lines.slice(0, at), ...Array.from({ length: next(6) }, () => next(WIDTH)), ...lines.slice(at + next(4))];
      const current = page(edited);
      const golden = page(lines);
      // A narrower hunk leaves the rest of its rows matching, which this whole-row check can't credit.
      const hunks = findHunks(current, golden);
      if (hunks.some(({ current: c, golden: g }) => c.width < WIDTH && g.width < WIDTH)) continue;
      checked += 1;
      const rowOf = (image: RawImage, y: number) => Buffer.from(image.pixels.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3));
      const kept = (image: RawImage, side: "current" | "golden") => {
        const rows: Buffer[] = [];
        for (let y = 0; y < image.height; y++) {
          if (!hunks.some((r) => y >= r[side].y && y < r[side].y + r[side].height)) rows.push(rowOf(image, y));
        }
        return rows;
      };
      const a = kept(current, "current");
      const b = kept(golden, "golden");
      expect(a.length).toBe(b.length);
      a.forEach((row, i) => expect(row.compare(b[i]!)).toBe(0));
    }
    expect(checked).toBeGreaterThan(20);
  });
});
