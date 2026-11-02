// Grouping a diff's regions for a person to look at. It changes what's shown together, and never
// what's compared or what a decision is on, so a project can change its distance freely.
import type { BoundingBox, ChangedRegion } from "./api.ts";

/** Regions close enough to read as one change, and the box around them in each image. */
export interface RegionGroup extends ChangedRegion {
  readonly regions: readonly ChangedRegion[];
}

function hull(p: BoundingBox, q: BoundingBox): BoundingBox {
  if (p.width === 0 || p.height === 0) return q;
  if (q.width === 0 || q.height === 0) return p;
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  return { x, y, width: Math.max(p.x + p.width, q.x + q.width) - x, height: Math.max(p.y + p.height, q.y + q.height) - y };
}

function within(p: BoundingBox, q: BoundingBox, distance: number): boolean {
  const across = Math.max(p.x, q.x) - Math.min(p.x + p.width, q.x + q.width);
  const down = Math.max(p.y, q.y) - Math.min(p.y + p.height, q.y + q.height);
  return across <= distance && down <= distance;
}

function closePair(groups: readonly RegionGroup[], distance: number): readonly [number, number] | null {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (within(groups[i]!.current, groups[j]!.current, distance)) return [i, j];
    }
  }
  return null;
}

/** Joins regions until no two groups are within `distance` image pixels of each other. In reading order. */
export function groupRegions(regions: readonly ChangedRegion[], distance: number): readonly RegionGroup[] {
  const groups: RegionGroup[] = regions.map((region) => ({ ...region, regions: [region] }));
  for (let pair = closePair(groups, distance); pair !== null; pair = closePair(groups, distance)) {
    const [i, j] = pair;
    const [p, q] = [groups[i]!, groups[j]!];
    groups[i] = { current: hull(p.current, q.current), golden: hull(p.golden, q.golden), regions: [...p.regions, ...q.regions] };
    groups.splice(j, 1);
  }
  return groups.sort((p, q) => p.current.y - q.current.y || p.current.x - q.current.x);
}
