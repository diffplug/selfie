// Which parts of two images correspond and differ: a recursive 9-slice. Trimming what matches from
// all four sides leaves the center of a 9-slice, whose outer cells are unchanged. A center that can
// be cut at a long enough identical span is sliced again on each side, and what's left is a region.
// This depends on the two images alone, so the same pair always gives the same regions.
import { createHash } from "node:crypto";
import type { RawImage } from "selfie-store";
import type { BoundingBox, ChangedRegion } from "selfie-ui/app";

/** A shorter span could be anything, such as one line of text. */
const MIN_ANCHOR_ROWS = 4;
/** A shorter gap is usually inside one thing, such as between lines of text. */
const MIN_GAP = 12;
/** Past this, a pathological image stops being cut, and what's left is one region. */
const MAX_DEPTH = 60;

type Box = { -readonly [K in keyof BoundingBox]: BoundingBox[K] };

const isEmpty = ({ width, height }: BoundingBox) => width === 0 || height === 0;

const rowOf = ({ pixels, width }: RawImage, { x, width: columns }: BoundingBox, y: number) =>
  pixels.subarray((y * width + x) * 3, (y * width + x + columns) * 3);

const rowsMatch = (a: RawImage, aBox: BoundingBox, aY: number, b: RawImage, bBox: BoundingBox, bY: number) =>
  Buffer.compare(rowOf(a, aBox, aY), rowOf(b, bBox, bY)) === 0;

function columnsMatch(a: RawImage, aBox: BoundingBox, aX: number, b: RawImage, bBox: BoundingBox, bX: number): boolean {
  for (let row = 0; row < aBox.height; row++) {
    const p = ((aBox.y + row) * a.width + aX) * 3;
    const q = ((bBox.y + row) * b.width + bX) * 3;
    if (a.pixels[p] !== b.pixels[q] || a.pixels[p + 1] !== b.pixels[q + 1] || a.pixels[p + 2] !== b.pixels[q + 2]) return false;
  }
  return true;
}

/** One color all the way across, which matches anywhere, so it says nothing about where it belongs. */
function isFlat(row: Uint8Array): boolean {
  for (let i = 3; i < row.length; i++) if (row[i] !== row[i - 3]) return false;
  return true;
}

/** Each image's row keys by the columns they cover, since a cut across rows keeps those, so nothing hashes twice. */
const rowKeys = new WeakMap<RawImage, Map<string, (string | undefined)[]>>();

function keyOfRow(image: RawImage, box: BoundingBox, y: number): string {
  const byColumns = rowKeys.get(image) ?? new Map<string, (string | undefined)[]>();
  rowKeys.set(image, byColumns);
  const columns = `${box.x},${box.width}`;
  const keys = byColumns.get(columns) ?? [];
  byColumns.set(columns, keys);
  return (keys[y] ??= createHash("sha1").update(rowOf(image, box, y)).digest("latin1"));
}

/** Trims both boxes in place, for as long as anything matches on any side. */
function trimMatching(a: RawImage, aBox: Box, b: RawImage, bBox: Box): void {
  let moved = true;
  const both = (step: (box: Box) => void) => {
    step(aBox);
    step(bBox);
    moved = true;
  };
  while (moved) {
    moved = false;
    if (aBox.width === bBox.width) {
      while (!isEmpty(aBox) && !isEmpty(bBox) && rowsMatch(a, aBox, aBox.y, b, bBox, bBox.y)) both((box) => { box.y += 1; box.height -= 1; });
      while (!isEmpty(aBox) && !isEmpty(bBox) && rowsMatch(a, aBox, aBox.y + aBox.height - 1, b, bBox, bBox.y + bBox.height - 1)) both((box) => { box.height -= 1; });
    }
    if (aBox.height === bBox.height) {
      while (!isEmpty(aBox) && !isEmpty(bBox) && columnsMatch(a, aBox, aBox.x, b, bBox, bBox.x)) both((box) => { box.x += 1; box.width -= 1; });
      while (!isEmpty(aBox) && !isEmpty(bBox) && columnsMatch(a, aBox, aBox.x + aBox.width - 1, b, bBox, bBox.x + bBox.width - 1)) both((box) => { box.width -= 1; });
    }
  }
}

interface Span {
  readonly a: number;
  readonly b: number;
  readonly length: number;
}

/**
 * The longest run of identical rows holding a row that appears once in each box and isn't flat.
 * Rows that repeat, such as blank space, borders, and table rows, could be matched to the wrong one.
 */
function longestAnchor(aKeys: readonly string[], bKeys: readonly string[], aRowIsFlat: (row: number) => boolean): Span | null {
  const aCount = new Map<string, number>();
  for (const key of aKeys) aCount.set(key, (aCount.get(key) ?? 0) + 1);
  const bCount = new Map<string, number>();
  const bAt = new Map<string, number>();
  bKeys.forEach((key, at) => {
    bCount.set(key, (bCount.get(key) ?? 0) + 1);
    bAt.set(key, at);
  });

  let best: Span | null = null;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]!;
    if (aCount.get(key) !== 1 || bCount.get(key) !== 1 || aRowIsFlat(i)) continue;
    const j = bAt.get(key)!;
    let before = 0;
    while (i - before > 0 && j - before > 0 && aKeys[i - before - 1] === bKeys[j - before - 1]) before += 1;
    let after = 0;
    while (i + after + 1 < aKeys.length && j + after + 1 < bKeys.length && aKeys[i + after + 1] === bKeys[j + after + 1]) after += 1;
    const length = before + after + 1;
    if (best === null || length > best.length) best = { a: i - before, b: j - before, length };
    // Any other row in this run would find this same run.
    i += after;
  }
  return best;
}

/** The longest run where `same(at)` holds. */
function longestGap(count: number, same: (at: number) => boolean): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let start = 0;
  for (let at = 0; at <= count; at++) {
    if (at < count && same(at)) continue;
    if (at - start > best.length) best = { start, length: at - start };
    start = at + 1;
  }
  return best;
}

function slice(a: RawImage, aFrom: BoundingBox, b: RawImage, bFrom: BoundingBox, depth: number, found: ChangedRegion[]): void {
  const aBox: Box = { ...aFrom };
  const bBox: Box = { ...bFrom };
  trimMatching(a, aBox, b, bBox);
  if (isEmpty(aBox) && isEmpty(bBox)) return;
  const leaf = () => found.push({ current: aBox, golden: bBox });
  if (isEmpty(aBox) || isEmpty(bBox) || aBox.width !== bBox.width || depth >= MAX_DEPTH) return void leaf();

  const cutRows = ({ a: aAt, b: bAt, length }: Span) => {
    slice(a, { ...aBox, height: aAt }, b, { ...bBox, height: bAt }, depth + 1, found);
    const aEnd = aAt + length;
    const bEnd = bAt + length;
    slice(a, { ...aBox, y: aBox.y + aEnd, height: aBox.height - aEnd }, b, { ...bBox, y: bBox.y + bEnd, height: bBox.height - bEnd }, depth + 1, found);
  };

  const aKeys = Array.from({ length: aBox.height }, (_, row) => keyOfRow(a, aBox, aBox.y + row));
  const bKeys = Array.from({ length: bBox.height }, (_, row) => keyOfRow(b, bBox, bBox.y + row));
  const anchor = longestAnchor(aKeys, bKeys, (row) => isFlat(rowOf(a, aBox, aBox.y + row)));
  if (anchor !== null && anchor.length >= MIN_ANCHOR_ROWS) return cutRows(anchor);
  if (aBox.height !== bBox.height) return void leaf();

  const rowGap = longestGap(aBox.height, (row) => aKeys[row] === bKeys[row]);
  if (rowGap.length >= MIN_GAP) return cutRows({ a: rowGap.start, b: rowGap.start, length: rowGap.length });

  const columnGap = longestGap(aBox.width, (column) => columnsMatch(a, aBox, aBox.x + column, b, bBox, bBox.x + column));
  if (columnGap.length < MIN_GAP) return void leaf();
  const end = columnGap.start + columnGap.length;
  slice(a, { ...aBox, width: columnGap.start }, b, { ...bBox, width: columnGap.start }, depth + 1, found);
  slice(a, { ...aBox, x: aBox.x + end, width: aBox.width - end }, b, { ...bBox, x: bBox.x + end, width: bBox.width - end }, depth + 1, found);
}

/**
 * Everything outside the regions matches, once what's between them has been lined up. In reading
 * order. Two images of different widths, whose rows can't compare, are cut no further.
 */
export function findRegions(current: RawImage, golden: RawImage): readonly ChangedRegion[] {
  const found: ChangedRegion[] = [];
  const whole = ({ width, height }: RawImage) => ({ x: 0, y: 0, width, height });
  slice(current, whole(current), golden, whole(golden), 0, found);
  return found.sort((p, q) => p.current.y - q.current.y || p.current.x - q.current.x);
}
