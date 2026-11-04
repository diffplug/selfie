// Grouping a diff's hunks for a person to look at. It changes what's shown together, and never
// what's compared or what a decision is on, so a project can change its distance freely.
import type { BoundingBox, BoxPair, ChangedHunk, PixelDiff, HunkKind } from "./api.ts";

/** Hunks close enough to read as one change, and the box around them in each image. */
export interface HunkGroup extends BoxPair {
  /** The most that any of them is: changed, then moved, then spacing. */
  readonly kind: HunkKind;
  readonly hunks: readonly ChangedHunk[];
}

/** Nothing changed but where things are, which a person still decides is right. */
export const isLayoutOnly = ({ changedPixels }: PixelDiff) => changedPixels === 0;

const strongest = (p: HunkKind, q: HunkKind): HunkKind => (p === "changed" || q === "changed" ? "changed" : p === "moved" || q === "moved" ? "moved" : "spacing");

export const describeBox = ({ x, y, width, height }: BoundingBox) => `${width}×${height} at ${x}, ${y}`;

/** A side of a hunk that only the other image has. */
export const isEmptyBox = ({ width, height }: BoundingBox) => width === 0 || height === 0;

export function hull(p: BoundingBox, q: BoundingBox): BoundingBox {
  if (isEmptyBox(p)) return q;
  if (isEmptyBox(q)) return p;
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  return { x, y, width: Math.max(p.x + p.width, q.x + q.width) - x, height: Math.max(p.y + p.height, q.y + q.height) - y };
}

function within(p: BoundingBox, q: BoundingBox, distance: number): boolean {
  const across = Math.max(p.x, q.x) - Math.min(p.x + p.width, q.x + q.width);
  const down = Math.max(p.y, q.y) - Math.min(p.y + p.height, q.y + q.height);
  return across <= distance && down <= distance;
}

function closePair(groups: readonly HunkGroup[], distance: number): readonly [number, number] | null {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (within(groups[i]!.current, groups[j]!.current, distance)) return [i, j];
    }
  }
  return null;
}

/** Joins hunks until no two groups are within `distance` image pixels of each other. In reading order. */
export function groupHunks(hunks: readonly ChangedHunk[], distance: number): readonly HunkGroup[] {
  const groups: HunkGroup[] = hunks.map((hunk) => ({ current: hunk.current, golden: hunk.golden, kind: hunk.kind, hunks: [hunk] }));
  for (let pair = closePair(groups, distance); pair !== null; pair = closePair(groups, distance)) {
    const [i, j] = pair;
    const [p, q] = [groups[i]!, groups[j]!];
    groups[i] = { current: hull(p.current, q.current), golden: hull(p.golden, q.golden), kind: strongest(p.kind, q.kind), hunks: [...p.hunks, ...q.hunks] };
    groups.splice(j, 1);
  }
  return groups.sort((p, q) => p.current.y - q.current.y || p.current.x - q.current.x);
}
