// What a hunk's difference is: changed, moved, or spacing. Moved and spacing can make a real change
// look like nothing, so most of this is about what they must never hide.
import type { RawImage } from "selfie-store";
import { describe, expect, test } from "vitest";
import { diffImages } from "../src/diff.ts";

const WHITE = [255, 255, 255];
const INK = [20, 20, 20];
const BLUE = [9, 105, 218];
const RED = [220, 0, 0];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: readonly number[];
  /** Holes in this pattern make a block's content its own, as text would, since blocks match by what's in them. */
  readonly pattern?: number;
}

function draw(width: number, height: number, boxes: readonly Box[], background = WHITE): RawImage {
  const pixels = new Uint8Array(width * height * 3);
  for (let at = 0; at < pixels.length; at += 3) pixels.set(background, at);
  for (const { x, y, width: w, height: h, color, pattern } of boxes) {
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        if (pattern === undefined || isInked(column, row, pattern)) pixels.set(color, ((y + row) * width + x + column) * 3);
      }
    }
  }
  return { width, height, pixels };
}

const isInked = (column: number, row: number, pattern: number) => column === 0 || row === 0 || row === 5 || column === 29 || (column * 3 + row * 5 + pattern) % 7 < 4;

const text = (x: number, y: number, pattern: number): Box => ({ x, y, width: 30, height: 6, color: INK, pattern });
const inkIn = (pattern: number) => {
  let count = 0;
  for (let row = 0; row < 6; row++) for (let column = 0; column < 30; column++) if (isInked(column, row, pattern)) count += 1;
  return count;
};

const pixelAt = ({ pixels, width }: RawImage, x: number, y: number) => [...pixels.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];

describe("moved", () => {
  test("a block that went sideways is moved, and nothing changed", () => {
    const golden = draw(200, 40, [text(10, 10, 3)]);
    const current = draw(200, 40, [text(100, 10, 3)]);
    const { diff } = diffImages(current, golden);
    expect(diff).toMatchObject({ changedPixels: 0, movedPixels: 180, spacingPixels: 0, maxChannelDelta: 0 });
    // Two hunks, since the columns between them match: one lost it, and one gained it.
    expect(diff.hunks.map(({ kind, changedPixels }) => [kind, changedPixels])).toEqual([["moved", 0], ["moved", 0]]);
    expect(diff.hunks.flatMap(({ moved }) => moved)).toEqual([{ current: { x: 100, y: 10, width: 30, height: 6 }, golden: { x: 10, y: 10, width: 30, height: 6 } }]);
  });

  test("what moved beside what changed is counted apart", () => {
    const list = (thumb: number, at: number) => [{ x: 10, y: 10, width: 40, height: thumb, color: BLUE }, text(at, 10, 2), text(at, 30, 3)];
    const { diff } = diffImages(draw(200, 90, list(50, 120)), draw(200, 90, list(30, 70)));
    expect(diff.movedPixels).toBe(360);
    expect(diff.changedPixels).toBe(40 * 20);
    expect(diff.firstChanged).toEqual({ x: 10, y: 40 });
  });

  test("a solid shape that moved is one entry, not one per column", () => {
    const button = (x: number) => [{ x, y: 10, width: 100, height: 20, color: BLUE }];
    const { diff } = diffImages(draw(400, 40, button(250)), draw(400, 40, button(10)));
    expect(diff).toMatchObject({ changedPixels: 0, movedPixels: 2000 });
    expect(diff.hunks.flatMap(({ moved }) => moved)).toEqual([{ current: { x: 250, y: 10, width: 100, height: 20 }, golden: { x: 10, y: 10, width: 100, height: 20 } }]);
  });

  test("the diff image tints what moved and marks what changed", () => {
    const golden = draw(200, 40, [text(10, 10, 3)]);
    const current = draw(200, 40, [text(100, 10, 3), { x: 150, y: 30, width: 4, height: 4, color: RED }]);
    const { highlighted } = diffImages(current, golden);
    const moved = pixelAt(highlighted, 105, 12);
    expect(moved[2]!).toBeGreaterThan(moved[0]!);
    expect(pixelAt(highlighted, 150, 30)).toEqual([255, 0, 80]);
  });

  test("what's in the same place in its hunk stayed, though rows above pushed the hunk down", () => {
    const blocks = (top: number, first: number, last: number) => [
      text(first, top, 2),
      { x: 20, y: top + 7, width: 30, height: 1, color: RED, pattern: 3 },
      text(last, top + 9, 3),
    ];
    const heading = text(10, 4, 5);
    const { diff } = diffImages(draw(120, 90, [heading, ...blocks(60, 40, 30)]), draw(120, 70, [heading, ...blocks(40, 10, 60)]));
    expect(diff).toMatchObject({ changedPixels: 0, spacingPixels: 2400 });
    expect(diff.hunks.flatMap(({ moved }) => moved).map(({ current }) => current.x).sort()).toEqual([30, 40]);
  });

  test("a panel of flat rows that moved is one entry, not one per row", () => {
    const panel = (y: number) => [{ x: 0, y, width: 200, height: 50, color: [240, 240, 240] }, text(20, y + 10, 4)];
    const { diff } = diffImages(draw(200, 120, panel(40)), draw(200, 120, panel(10)));
    expect(diff.changedPixels).toBe(0);
    expect(diff.hunks.flatMap(({ moved }) => moved).length).toBeLessThanOrEqual(3);
  });

  test("identical content doesn't get matched twice", () => {
    const golden = draw(200, 40, [text(10, 10, 3)]);
    const current = draw(200, 40, [text(70, 10, 3), text(130, 10, 3)]);
    expect(diffImages(current, golden).diff).toMatchObject({ changedPixels: inkIn(3), movedPixels: 180 });
  });

  test("what the golden had and the current doesn't is changed, and never just moved", () => {
    const golden = draw(200, 40, [text(10, 10, 3), text(70, 10, 9)]);
    const current = draw(200, 40, [text(100, 10, 3)]);
    const { diff } = diffImages(current, golden);
    expect(diff.changedPixels).toBeGreaterThanOrEqual(179);
    expect(diff.hunks[0]?.kind).toBe("changed");
  });

  test("isn't claimed of a block too small to say it's the same thing", () => {
    const dot = (x: number) => [text(10, 10, 3), { x, y: 12, width: 1, height: 1, color: RED }];
    const { diff } = diffImages(draw(200, 40, dot(80)), draw(200, 40, dot(120)));
    expect(diff).toMatchObject({ changedPixels: 2, movedPixels: 0 });
  });
});

describe("spacing", () => {
  const above = text(10, 4, 3);
  const below = (offset: number) => text(10, 20 + offset, 9);

  test("a band of background that grew is spacing, and nothing changed", () => {
    const { diff, highlighted } = diffImages(draw(200, 50, [above, below(10)]), draw(200, 40, [above, below(0)]));
    expect(diff).toMatchObject({ changedPixels: 0, movedPixels: 0, spacingPixels: 2000 });
    expect(diff.hunks).toMatchObject([{ kind: "spacing", changedPixels: 0 }]);
    const { y } = diff.hunks[0]!.current;
    expect(pixelAt(highlighted, 0, y)).toEqual([255, 214, 102]);
    expect(diff.boundingBox).toEqual(diff.hunks[0]!.current);
  });

  test("a band of background that shrank is spacing, with a seam for where", () => {
    const { diff, highlighted } = diffImages(draw(200, 40, [above, below(0)]), draw(200, 50, [above, below(10)]));
    expect(diff).toMatchObject({ changedPixels: 0, spacingPixels: 2000 });
    const { y } = diff.hunks[0]!.current;
    expect(pixelAt(highlighted, 0, y)).toEqual([255, 214, 102]);
  });

  test("a new solid banner is changed, though it's one color all the way across", () => {
    const banner = { x: 0, y: 14, width: 200, height: 10, color: RED };
    const { diff } = diffImages(draw(200, 50, [above, banner, below(10)]), draw(200, 40, [above, below(0)]));
    expect(diff).toMatchObject({ changedPixels: 2000, spacingPixels: 0 });
    expect(diff.hunks[0]?.kind).toBe("changed");
  });

  test("a colored panel that grew is spacing, since it's the color around the band", () => {
    const panel = (height: number) => [{ x: 0, y: 10, width: 200, height, color: [240, 240, 240] }, text(10, 12, 3), text(10, 10 + height - 8, 9)];
    const { diff } = diffImages(draw(200, 80, panel(50)), draw(200, 70, panel(40)));
    expect(diff).toMatchObject({ changedPixels: 0, spacingPixels: 2000 });
  });

  test("only as many rows as the heights differ by", () => {
    // Two rows taller, around plenty of blank rows: only two of them are spacing.
    const marks = [12, 17].map((y) => ({ x: 50, y, width: 2, height: 1, color: RED }));
    const { diff } = diffImages(draw(200, 42, [above, ...marks, below(2)]), draw(200, 40, [above, below(0)]));
    expect(diff.changedPixels).toBeGreaterThan(0);
    expect(diff.spacingPixels).toBeLessThanOrEqual(400);
  });

  test("a change beside moved text stays a change, with the other two counted apart", () => {
    const golden = draw(300, 60, [text(10, 4, 3), text(10, 20, 9), { x: 10, y: 40, width: 30, height: 10, color: BLUE }]);
    const current = draw(300, 70, [text(10, 4, 3), text(150, 30, 9), { x: 10, y: 50, width: 30, height: 10, color: RED }]);
    const { diff } = diffImages(current, golden);
    expect(diff.changedPixels).toBeGreaterThanOrEqual(300);
    expect(diff.movedPixels + diff.spacingPixels).toBeGreaterThan(0);
  });
});

describe("what moved and spacing can't hide", () => {
  /** The same small pages every batch, since a failure here should be one anyone can reproduce. */
  function random(seed: number) {
    let state = seed;
    return (below: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % below;
    };
  }

  const layout = (next: (below: number) => number) => {
    const boxes: Box[] = [];
    let y = 4 + next(6);
    for (let i = next(4) + 2; i > 0; i--) {
      boxes.push(text(4 + next(80), y, next(7)));
      y += 8 + next(8);
    }
    return { boxes, height: y + 4 + next(6) };
  };

  test("with nothing changed, every pixel is in place, background, or an identical block from the golden", () => {
    let explained = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const next = random(seed);
      const before = layout(next);
      // Only sideways, so a row outside a hunk is at the same place in both.
      const after = before.boxes.map((block) => ({ ...block, x: 4 + next(80) }));
      const golden = draw(120, before.height, before.boxes);
      const current = draw(120, before.height, after);
      const { diff } = diffImages(current, golden);
      // Rows can line up with identical rows elsewhere, and then what's outside a hunk isn't in place.
      if (diff.changedPixels !== 0 || diff.hunks.some(({ current: here, golden: there }) => here.y !== there.y)) continue;
      explained += 1;
      const movedTo = (x: number, y: number) => diff.hunks.flatMap(({ moved }) => moved).find((block) => x >= block.current.x && x < block.current.x + block.current.width && y >= block.current.y && y < block.current.y + block.current.height);
      for (let y = 0; y < current.height; y++) {
        for (let x = 0; x < current.width; x++) {
          const actual = pixelAt(current, x, y);
          const block = movedTo(x, y);
          if (block !== undefined) expect(actual).toEqual(pixelAt(golden, block.golden.x + x - block.current.x, block.golden.y + y - block.current.y));
          else if (actual[0] !== 255) expect(actual).toEqual(pixelAt(golden, x, y));
        }
      }
    }
    expect(explained).toBeGreaterThan(100);
  });

  test("a pixel of a color nothing has is always changed", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const next = random(seed);
      const before = layout(next);
      const after = before.boxes.map((block) => ({ ...block, x: 4 + next(80) }));
      const moved = draw(120, before.height, after);
      moved.pixels.set([1, 200, 3], (next(before.height) * 120 + next(120)) * 3);
      const { diff } = diffImages(moved, draw(120, before.height, before.boxes));
      expect(diff.changedPixels, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });
});
