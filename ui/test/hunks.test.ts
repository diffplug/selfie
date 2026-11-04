import { describe, expect, test } from "vitest";
import type { ChangedHunk, HunkKind } from "../src/shared/api.ts";
import { groupHunks } from "../src/shared/hunks.ts";

const at = (x: number, y: number, width = 4, height = 2, kind: HunkKind = "changed"): ChangedHunk => {
  const box = { x, y, width, height };
  return { current: box, golden: box, kind, changedPixels: kind === "changed" ? 1 : 0, moved: [] };
};

describe("groupHunks", () => {
  test("joins hunks within the distance, and keeps which they were", () => {
    const [one, two] = [at(2, 5), at(2, 30)];
    expect(groupHunks([one, two], 22)).toHaveLength(2);
    const [group] = groupHunks([one, two], 23);
    expect(group?.current).toEqual({ x: 2, y: 5, width: 4, height: 27 });
    expect(group?.hunks).toEqual([one, two]);
  });

  test("is transitive, since what grew can reach something already passed", () => {
    expect(groupHunks([at(2, 2), at(2, 30), at(2, 16)], 12)).toHaveLength(1);
  });

  test("doesn't join across a wide gap just because rows overlap", () => {
    expect(groupHunks([at(2, 5), at(150, 5)], 12)).toHaveLength(2);
  });

  test("a hunk of nothing, where something was removed, joins by where it was", () => {
    const removed: ChangedHunk = { current: { x: 0, y: 8, width: 4, height: 0 }, golden: { x: 0, y: 8, width: 4, height: 3 }, kind: "changed", changedPixels: 12, moved: [] };
    const [group] = groupHunks([at(0, 5, 4, 2), removed], 12);
    expect(group?.current).toEqual({ x: 0, y: 5, width: 4, height: 2 });
    expect(group?.golden).toEqual({ x: 0, y: 5, width: 4, height: 6 });
  });

  test("a group is the most that any of its hunks is", () => {
    const kindOf = (...kinds: HunkKind[]) => groupHunks(kinds.map((kind, i) => at(2, i * 3, 4, 2, kind)), 12)[0]?.kind;
    expect(kindOf("spacing", "spacing")).toBe("spacing");
    expect(kindOf("spacing", "moved")).toBe("moved");
    expect(kindOf("moved", "changed", "spacing")).toBe("changed");
  });

  test("comes out in reading order", () => {
    expect(groupHunks([at(50, 40), at(100, 2), at(1, 2)], 0).map(({ current }) => [current.x, current.y])).toEqual([[1, 2], [100, 2], [50, 40]]);
  });

  test("has nothing to group with nothing", () => {
    expect(groupHunks([], 12)).toEqual([]);
  });
});
