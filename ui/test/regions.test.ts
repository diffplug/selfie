import { describe, expect, test } from "vitest";
import { groupRegions } from "../src/shared/regions.ts";

const at = (x: number, y: number, width = 4, height = 2) => {
  const box = { x, y, width, height };
  return { current: box, golden: box };
};

describe("groupRegions", () => {
  test("joins regions within the distance, and keeps which they were", () => {
    const [one, two] = [at(2, 5), at(2, 30)];
    expect(groupRegions([one, two], 22)).toHaveLength(2);
    const [group] = groupRegions([one, two], 23);
    expect(group?.current).toEqual({ x: 2, y: 5, width: 4, height: 27 });
    expect(group?.regions).toEqual([one, two]);
  });

  test("is transitive, since what grew can reach something already passed", () => {
    expect(groupRegions([at(2, 2), at(2, 30), at(2, 16)], 12)).toHaveLength(1);
  });

  test("doesn't join across a wide gap just because rows overlap", () => {
    expect(groupRegions([at(2, 5), at(150, 5)], 12)).toHaveLength(2);
  });

  test("a region of nothing, where something was removed, joins by where it was", () => {
    const removed = { current: { x: 0, y: 8, width: 4, height: 0 }, golden: { x: 0, y: 8, width: 4, height: 3 } };
    const [group] = groupRegions([at(0, 5, 4, 2), removed], 12);
    expect(group?.current).toEqual({ x: 0, y: 5, width: 4, height: 2 });
    expect(group?.golden).toEqual({ x: 0, y: 5, width: 4, height: 6 });
  });

  test("comes out in reading order", () => {
    expect(groupRegions([at(50, 40), at(100, 2), at(1, 2)], 0).map(({ current }) => [current.x, current.y])).toEqual([[1, 2], [100, 2], [50, 40]]);
  });

  test("has nothing to group with nothing", () => {
    expect(groupRegions([], 12)).toEqual([]);
  });
});
