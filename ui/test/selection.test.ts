import { describe, expect, test } from "vitest";
import type { BoundingBox, ChangedHunk, HunkKind } from "../src/shared/api.ts";
import type { HunkGroup } from "../src/shared/hunks.ts";
import { describeHunkPlace, describeHunkSize, stepped, toggled } from "../src/client/selection.ts";
import { boxBetween } from "../src/client/useDrawnBox.ts";

describe("stepped", () => {
  test("starts from whichever end the step comes in at", () => {
    expect(stepped(null, 3, 1)).toBe(0);
    expect(stepped(null, 3, -1)).toBe(2);
  });

  test("wraps around both ways", () => {
    expect(stepped(2, 3, 1)).toBe(0);
    expect(stepped(0, 3, -1)).toBe(2);
    expect(stepped(1, 3, 1)).toBe(2);
  });

  test("has nowhere to go with no hunks", () => {
    expect(stepped(null, 0, 1)).toBeNull();
  });
});

test("toggled leaves what it was given alone", () => {
  const selected = new Set([1]);
  expect([...toggled(selected, 2)].sort()).toEqual([1, 2]);
  expect([...toggled(selected, 1)]).toEqual([]);
  expect([...selected]).toEqual([1]);
});

const box = (x: number, y: number, width: number, height: number): BoundingBox => ({ x, y, width, height });

function groupOf(kind: HunkKind, current: BoundingBox, golden: BoundingBox, hunks: Partial<ChangedHunk>[] = []): HunkGroup {
  return { kind, current, golden, hunks: hunks.map((hunk) => ({ current, golden, kind, changedPixels: 0, moved: [], ...hunk })) };
}

describe("describing a hunk", () => {
  test("says where it is, and where it was only if that's different", () => {
    const here = box(32, 88, 182, 18);
    expect(describeHunkPlace(groupOf("changed", here, here))).toBe("182×18 at 32, 88");
    expect(describeHunkPlace(groupOf("changed", here, box(32, 60, 182, 18)))).toBe("182×18 at 32, 88, from 182×18 at 32, 60");
  });

  test("says when only one side has it", () => {
    expect(describeHunkPlace(groupOf("changed", box(0, 8, 40, 0), box(0, 8, 40, 3)))).toBe("Only in the golden, 40×3 at 0, 8");
    expect(describeHunkPlace(groupOf("changed", box(0, 8, 40, 3), box(0, 8, 40, 0)))).toBe("Only in the current image, 40×3 at 0, 8");
  });

  test("a changed one counts all its hunks' pixels", () => {
    const here = box(0, 0, 10, 10);
    expect(describeHunkSize(groupOf("changed", here, here, [{ changedPixels: 1 }]))).toBe("1 pixel changed");
    expect(describeHunkSize(groupOf("changed", here, here, [{ changedPixels: 1000 }, { changedPixels: 234 }]))).toBe("1,234 pixels changed");
  });

  test("a moved one says what landed, or that what was here left", () => {
    const here = box(0, 0, 10, 10);
    expect(describeHunkSize(groupOf("moved", here, here, [{ moved: [{ current: box(0, 0, 4, 5), golden: box(9, 9, 4, 5) }] }]))).toBe("20 pixels moved here");
    expect(describeHunkSize(groupOf("moved", here, here, [{}]))).toBe("What was here moved elsewhere");
  });

  test("spacing says which way it went", () => {
    expect(describeHunkSize(groupOf("spacing", box(0, 0, 10, 30), box(0, 0, 10, 0)))).toBe("30 rows taller");
    expect(describeHunkSize(groupOf("spacing", box(0, 0, 10, 0), box(0, 0, 10, 1)))).toBe("1 row shorter");
  });
});

describe("boxBetween", () => {
  const size = { width: 100, height: 50 };
  test("goes either way, in whole pixels that cover what was drawn", () => {
    expect(boxBetween({ x: 10.5, y: 20.5 }, { x: 30.2, y: 40.2 }, size)).toEqual({ x: 10, y: 20, width: 21, height: 21 });
    expect(boxBetween({ x: 30.2, y: 40.2 }, { x: 10.5, y: 20.5 }, size)).toEqual({ x: 10, y: 20, width: 21, height: 21 });
  });

  test("stays inside the image, however far a drag goes", () => {
    expect(boxBetween({ x: -20, y: -20 }, { x: 500, y: 500 }, size)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});
