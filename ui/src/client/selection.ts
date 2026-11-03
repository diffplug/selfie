// Which of a story's regions someone has picked out, which they're looking at, and how the list says what
// each one is. Pure, so a test needs no browser.
import type { BoundingBox } from "../shared/api.ts";
import { describeBox, isEmptyBox, type RegionGroup } from "../shared/regions.ts";
import { plural } from "./plural.ts";

/** One step through `count` regions, wrapping around, from none to whichever end the step comes in at. */
export function stepped(focused: number | null, count: number, by: 1 | -1): number | null {
  if (count === 0) return null;
  if (focused === null) return by === 1 ? 0 : count - 1;
  return (focused + by + count) % count;
}

export function toggled<T>(selected: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(selected);
  if (!next.delete(item)) next.add(item);
  return next;
}

const sameBox = (p: BoundingBox, q: BoundingBox) => p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;

/** Where a group is in the current image, and in the golden if that's different. */
export function describeRegionPlace({ current, golden }: RegionGroup): string {
  if (isEmptyBox(current)) return `Only in the golden, ${describeBox(golden)}`;
  if (isEmptyBox(golden)) return `Only in the current image, ${describeBox(current)}`;
  return sameBox(current, golden) ? describeBox(current) : `${describeBox(current)}, from ${describeBox(golden)}`;
}

/** How much a group holds, in whichever terms its kind is about. */
export function describeRegionSize({ kind, current, golden, regions }: RegionGroup): string {
  if (kind === "changed") return `${plural(regions.reduce((sum, { changedPixels }) => sum + changedPixels, 0), "pixel")} changed`;
  if (kind === "moved") {
    const moved = regions.flatMap(({ moved: blocks }) => blocks).reduce((sum, { current: block }) => sum + block.width * block.height, 0);
    return moved === 0 ? "What was here moved elsewhere" : `${plural(moved, "pixel")} moved here`;
  }
  const rows = current.height - golden.height;
  return `${plural(Math.abs(rows), "row")} ${rows > 0 ? "taller" : "shorter"}`;
}
