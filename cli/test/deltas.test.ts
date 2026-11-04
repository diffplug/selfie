// What the page relies on: the differ's hunks account for everything, so redrawing them onto the
// golden gives exactly what's left, with no need to compare any pixels again.
import type { RawImage } from "selfie-store";
import { canApply, patchGolden } from "selfie-ui/deltas";
import { describe, expect, test } from "vitest";
import { diffImages } from "../src/diff.ts";

const WIDTH = 120;

/** Every row its own, as with real text, so rows line up across images. */
function page(rows: readonly (readonly [number, number, number])[]): RawImage {
  const pixels = new Uint8Array(WIDTH * rows.length * 3);
  rows.forEach((row, y) => {
    for (let x = 0; x < WIDTH; x++) pixels.set([(row[0] + x * (y % 5)) & 255, row[1], row[2]], (y * WIDTH + x) * 3);
  });
  return { width: WIDTH, height: rows.length, pixels };
}

const rowsOf = (from: number, count: number) => Array.from({ length: count }, (_, at): readonly [number, number, number] => [(from + at) & 255, ((from + at) * 7) & 255, ((from + at) >> 8) & 255]);

const blank = (count: number) => Array.from({ length: count }, (): readonly [number, number, number] => [255, 255, 255]);

function redrawn(current: RawImage, golden: RawImage, accepted: readonly number[]) {
  const { diff } = diffImages(current, golden);
  const patch = patchGolden(diff, accepted);
  const { width, height } = patch.diff.golden;
  const pixels = new Uint8Array(width * height * 3);
  for (const { from, box, toX, toY } of patch.blits) {
    const source = from === "golden" ? golden : current;
    for (let row = 0; row < box.height; row++) {
      const start = ((box.y + row) * source.width + box.x) * 3;
      pixels.set(source.pixels.subarray(start, start + box.width * 3), ((toY + row) * width + toX) * 3);
    }
  }
  return { diff, patch, image: { width, height, pixels } satisfies RawImage };
}

/** A header that grows, a change further down, and a band below that closes up, as one real change did. */
const golden = page([...rowsOf(0, 8), ...rowsOf(1000, 20), ...rowsOf(100, 60), ...rowsOf(200, 4), ...rowsOf(300, 60), ...blank(15), ...rowsOf(400, 40)]);
const current = page([...rowsOf(0, 8), ...rowsOf(2000, 35), ...rowsOf(100, 60), ...rowsOf(600, 4), ...rowsOf(300, 60), ...rowsOf(400, 40)]);

function narrowed(image: RawImage): RawImage {
  const pixels = image.pixels.slice();
  for (let y = 30; y < 34; y++) for (let x = 40; x < 44; x++) pixels.set([1, 2, 3], (y * image.width + x) * 3);
  return { ...image, pixels };
}

describe("redrawing hunks onto the golden", () => {
  test("every hunk here can be applied, and there's more than one", () => {
    const { diff } = diffImages(current, golden);
    expect(diff.hunks.length).toBeGreaterThan(1);
    expect(diff.hunks.every((hunk) => canApply(hunk, diff))).toBe(true);
  });

  test("all of them give the current image, pixel for pixel", () => {
    const hunks = diffImages(current, golden).diff.hunks.map((_, index) => index);
    const { image, patch } = redrawn(current, golden, hunks);
    expect(patch.diff.hunks).toEqual([]);
    expect({ width: image.width, height: image.height }).toEqual({ width: current.width, height: current.height });
    expect(Buffer.compare(image.pixels, current.pixels)).toBe(0);
  });

  test("any of them, in any combination, leave exactly the others to find", () => {
    const { hunks } = diffImages(current, golden).diff;
    for (let mask = 0; mask < 1 << hunks.length; mask++) {
      const accepted = hunks.flatMap((_, index) => ((mask >> index) & 1 ? [index] : []));
      const { image, patch } = redrawn(current, golden, accepted);
      const again = diffImages(current, image).diff;
      expect(again.hunks.map(({ current: box }) => box)).toEqual(patch.diff.hunks.map(({ current: box }) => box));
      expect(again.hunks.map(({ golden: box }) => box)).toEqual(patch.diff.hunks.map(({ golden: box }) => box));
    }
  });

  test("a narrow hunk of one size goes where the golden has it, below one that grew", () => {
    const changed = narrowed(current);
    const { hunks } = diffImages(changed, golden).diff;
    const { image } = redrawn(changed, golden, hunks.map((_, index) => index));
    expect(Buffer.compare(image.pixels, changed.pixels)).toBe(0);
  });

  test("a change in width replaces the whole image", () => {
    const wider = { width: 100, height: 4, pixels: new Uint8Array(100 * 4 * 3).fill(9) };
    const narrower = { width: 80, height: 4, pixels: new Uint8Array(80 * 4 * 3).fill(200) };
    const { image } = redrawn(narrower, wider, [0]);
    expect(Buffer.compare(image.pixels, narrower.pixels)).toBe(0);
    expect(image.width).toBe(80);
  });
});
