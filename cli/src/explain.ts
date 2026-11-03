// What a hunk's difference really is. Content that's identical but elsewhere has moved, and a band
// of the surrounding color that grew or shrank is spacing. Whatever those can't account for is changed.
// The account is checked rather than trusted: the current side is rebuilt from what was matched, any
// pixel that comes out different is changed, and so is anything in the golden that matched nothing.
import { createHash } from "node:crypto";
import type { RawImage } from "selfie-store";
import type { BoundingBox, BoxPair, HunkKind } from "selfie-ui/app";
import { isFlat, rowOf } from "./hunks.ts";

/** A narrower gap is usually between words, and a word on its own could match anywhere. */
const MIN_COLUMN_GAP = 6;
/** Smaller than this, identical content elsewhere is a coincidence, so only one that stayed put counts: 3×3, or a line of 9. */
const MIN_MOVED_AREA = 9;
/** Colors are counted on every Nth row and column, which is plenty to find a page's background. */
const BACKGROUND_SAMPLE = 8;

type Packed = number;

export const packedAt = ({ pixels, width }: RawImage, x: number, y: number): Packed => {
  const at = (y * width + x) * 3;
  return (pixels[at]! << 16) | (pixels[at + 1]! << 8) | pixels[at + 2]!;
};

function isFlatColumn(image: RawImage, { y, height }: BoundingBox, x: number): boolean {
  const first = packedAt(image, x, y);
  for (let row = y + 1; row < y + height; row++) if (packedAt(image, x, row) !== first) return false;
  return true;
}

/** The most common color in an image, sampled. */
function backgroundOf(image: RawImage): Packed {
  const counts = new Map<Packed, number>();
  for (let y = 0; y < image.height; y += BACKGROUND_SAMPLE) {
    for (let x = 0; x < image.width; x += BACKGROUND_SAMPLE) {
      const color = packedAt(image, x, y);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  let best = 0;
  let most = -1;
  for (const [color, count] of counts) {
    if (count > most || (count === most && color < best)) {
      best = color;
      most = count;
    }
  }
  return best;
}

/**
 * Rows on this side beyond what the other side has, that are one color all the way across, where
 * that color is the background or the row just outside the box. So a band that grew qualifies, and
 * a new solid banner doesn't, unless it's the same color as what's around it.
 */
function spacingRows(image: RawImage, box: BoundingBox, extra: number, background: Packed): ReadonlySet<number> {
  const rows = new Set<number>();
  if (extra <= 0 || box.width === 0) return rows;
  const outside = [box.y - 1, box.y + box.height]
    .filter((y) => y >= 0 && y < image.height && isFlat(rowOf(image, box, y)))
    .map((y) => packedAt(image, box.x, y));
  for (let y = box.y; y < box.y + box.height && rows.size < extra; y++) {
    if (!isFlat(rowOf(image, box, y))) continue;
    const color = packedAt(image, box.x, y);
    if (color === background || outside.includes(color)) rows.add(y);
  }
  return rows;
}

/**
 * Cuts a box into blocks of content: at every flat row, and at wide flat columns. A flat line or solid
 * shape that isn't background, such as a border, is a block of its own, since it can move too.
 */
function blocksIn(image: RawImage, box: BoundingBox, background: Packed, blocks: BoundingBox[]): void {
  if (box.width <= 0 || box.height <= 0) return;

  const bands: BoundingBox[] = [];
  let start = -1;
  for (let y = box.y; y <= box.y + box.height; y++) {
    const atEnd = y === box.y + box.height;
    const flat = !atEnd && isFlat(rowOf(image, box, y));
    if (!atEnd && !flat) {
      if (start < 0) start = y;
      continue;
    }
    if (start >= 0) bands.push({ ...box, y: start, height: y - start });
    start = -1;
    if (flat && packedAt(image, box.x, y) !== background) blocks.push({ ...box, y, height: 1 });
  }
  if (bands.length !== 1 || bands[0]!.height !== box.height) {
    for (const band of bands) blocksIn(image, band, background, blocks);
    return;
  }

  // No row here is flat, so what's left to cut at is columns. In a short band plenty of columns are
  // flat, such as an l's stem, which is just part of what's beside it.
  const canBeLine = box.height >= MIN_MOVED_AREA;
  const end = box.x + box.width;
  const columns: BoundingBox[] = [];
  let from = -1;
  let gap = 0;
  const closeColumn = (to: number) => {
    if (from >= 0) columns.push({ ...box, x: from, width: to - gap - from });
    from = -1;
    gap = 0;
  };
  for (let x = box.x; x < end; x++) {
    const color = packedAt(image, x, box.y);
    const flat = isFlatColumn(image, box, x);
    if (flat && color === background) {
      gap += 1;
    } else if (flat && canBeLine) {
      closeColumn(x);
      let to = x + 1;
      while (to < end && packedAt(image, to, box.y) === color && isFlatColumn(image, box, to)) to += 1;
      blocks.push({ ...box, x, width: to - x });
      x = to - 1;
    } else {
      if (gap >= MIN_COLUMN_GAP) closeColumn(x);
      if (from < 0) from = x;
      gap = 0;
    }
  }
  closeColumn(end);
  if (columns.length === 1 && columns[0]!.width === box.width) {
    blocks.push(box);
    return;
  }
  for (const column of columns) blocksIn(image, column, background, blocks);
}

function hashOf(image: RawImage, box: BoundingBox): string {
  const hash = createHash("sha1").update(`${box.width}x${box.height}`);
  for (let y = box.y; y < box.y + box.height; y++) hash.update(rowOf(image, box, y));
  return hash.digest("latin1");
}

interface Block {
  readonly box: BoundingBox;
  readonly hash: string;
  readonly hunk: number;
  /** Where it is in its hunk past any spacing, so what spacing pushed along has stayed where it was. */
  readonly offset: string;
}

/** A hunk's blocks, past the rows that are spacing. */
function blocksOf(image: RawImage, box: BoundingBox, spacing: ReadonlySet<number>, background: Packed, hunk: number): Block[] {
  const boxes: BoundingBox[] = [];
  blocksIn(image, box, background, boxes);
  const spacingAbove = (y: number) => [...spacing].filter((row) => row < y).length;
  return boxes
    .filter(({ y, height }) => !(height === 1 && spacing.has(y)))
    .sort(inReadingOrder)
    .map((block) => ({ box: block, hash: hashOf(image, block), hunk, offset: `${block.x - box.x},${block.y - box.y - spacingAbove(block.y)}` }));
}

const inReadingOrder = (p: BoundingBox, q: BoundingBox) => p.y - q.y || p.x - q.x;

/** What the current side should hold at each pixel of a hunk, and what of the golden that leaves out. */
interface Account {
  /** By row and column within the hunk: a color, or -1 where the golden has nothing to compare with. */
  readonly expected: Int32Array;
  /** What landed here from somewhere else, in the golden. */
  readonly moved: readonly BoxPair[];
  /** Where in the current image's hunk something left from, for somewhere else. */
  readonly movedOut: readonly BoundingBox[];
  /** Pixels of the golden nothing accounts for. */
  readonly goldenOnly: number;
}

/** Row by row, skipping spacing on each side, from the top left. */
function comparedInPlace(golden: RawImage, { current, golden: there }: BoxPair, currentSpacing: ReadonlySet<number>, goldenSpacing: ReadonlySet<number>): Account {
  const expected = new Int32Array(current.width * current.height).fill(-1);
  const goldenRows: number[] = [];
  for (let y = there.y; y < there.y + there.height; y++) if (!goldenSpacing.has(y)) goldenRows.push(y);
  let next = 0;
  const columns = Math.min(current.width, there.width);
  for (let row = 0; row < current.height; row++) {
    if (currentSpacing.has(current.y + row)) continue;
    const goldenRow = goldenRows[next];
    next += 1;
    if (goldenRow === undefined) continue;
    for (let column = 0; column < columns; column++) expected[row * current.width + column] = packedAt(golden, there.x + column, goldenRow);
  }
  const sharedRows = Math.min(next, goldenRows.length);
  return { expected, moved: [], movedOut: [], goldenOnly: goldenRows.length * there.width - sharedRows * columns };
}

interface Pair {
  readonly here: Block;
  readonly there: Block;
  readonly how: "stayed" | "moved" | "replaced";
}

/**
 * Pairs blocks: those that stayed put, then those that moved within a hunk, then those that moved
 * anywhere, all identical. What's left of the same size in a hunk was replaced, so its pixels
 * compare, and count only once. Only staying put takes a block too small to say it's the same thing.
 */
function pairUp(heres: readonly Block[], theres: readonly Block[]): readonly Pair[] {
  const pairs: Pair[] = [];
  let hereLeft = heres;
  let thereLeft = theres;
  const pass = (how: Pair["how"], keyOf: (block: Block) => string, canMatch: (block: Block) => boolean) => {
    const available = new Map<string, Block[]>();
    // Backwards, so that popping takes them in reading order, however many identical rows there are.
    for (let i = thereLeft.length - 1; i >= 0; i--) {
      const there = thereLeft[i]!;
      if (!canMatch(there)) continue;
      const key = keyOf(there);
      const same = available.get(key);
      if (same === undefined) available.set(key, [there]);
      else same.push(there);
    }
    const used = new Set<Block>();
    hereLeft = hereLeft.filter((here) => {
      const there = canMatch(here) ? available.get(keyOf(here))?.pop() : undefined;
      if (there === undefined) return true;
      pairs.push({ here, there, how });
      used.add(there);
      return false;
    });
    thereLeft = thereLeft.filter((there) => !used.has(there));
  };
  const bigEnough = ({ box }: Block) => box.width * box.height >= MIN_MOVED_AREA;
  pass("stayed", ({ offset, hash, hunk }) => `${hunk},${offset},${hash}`, () => true);
  pass("moved", ({ hash, hunk }) => `${hunk},${hash}`, bigEnough);
  pass("moved", ({ hash }) => hash, bigEnough);
  pass("replaced", ({ box, hunk }) => `${hunk},${box.width}x${box.height}`, bigEnough);
  return pairs;
}

/** Joins a block to the one above it if they moved together, so a shifted panel is one entry, not one per row. */
function addMoved(moved: BoxPair[], block: BoxPair): void {
  const last = moved.at(-1);
  const joins =
    last !== undefined &&
    last.current.x === block.current.x &&
    last.current.width === block.current.width &&
    last.current.y + last.current.height === block.current.y &&
    last.golden.x === block.golden.x &&
    last.golden.width === block.golden.width &&
    last.golden.y + last.golden.height === block.golden.y;
  if (!joins) {
    moved.push(block);
    return;
  }
  const grow = ({ height, ...rest }: BoundingBox, by: number): BoundingBox => ({ ...rest, height: height + by });
  moved[moved.length - 1] = { current: grow(last.current, block.current.height), golden: grow(last.golden, block.current.height) };
}

/** A golden box where it would be in the current image's side of a hunk, as far as that's in the hunk. */
function inCurrent(box: BoundingBox, { current: here, golden: there }: BoxPair): BoundingBox {
  const x = Math.max(box.x + here.x - there.x, here.x);
  const y = Math.max(box.y + here.y - there.y, here.y);
  const right = Math.min(box.x + here.x - there.x + box.width, here.x + here.width);
  const bottom = Math.min(box.y + here.y - there.y + box.height, here.y + here.height);
  return { x, y, width: Math.max(right - x, 0), height: Math.max(bottom - y, 0) };
}

/** What a hunk's pairs say about it, which takes no pixels, so a hunk with no moves costs nothing. */
function movesOf(hunk: BoxPair, index: number, pairs: readonly Pair[], theres: readonly Block[]): Omit<Account, "expected"> {
  const paired = new Set(pairs.map(({ there }) => there));
  const landed = pairs.filter(({ here, how }) => how === "moved" && here.hunk === index).sort((p, q) => inReadingOrder(p.here.box, q.here.box));
  const moved: BoxPair[] = [];
  for (const { here, there } of landed) addMoved(moved, { current: here.box, golden: there.box });
  const movedOut = pairs.filter(({ here, there, how }) => how === "moved" && here.hunk !== index && there.hunk === index).map(({ there }) => inCurrent(there.box, hunk));
  let goldenOnly = 0;
  for (const there of theres) if (!paired.has(there)) goldenOnly += there.box.width * there.box.height;
  return { moved, movedOut, goldenOnly };
}

/** The background, with each block paired to one of the golden put back where it is now. */
function rebuilt(golden: RawImage, here: BoundingBox, index: number, pairs: readonly Pair[], background: Packed): Int32Array {
  const expected = new Int32Array(here.width * here.height).fill(background);
  for (const { here: block, there } of pairs) {
    if (block.hunk !== index) continue;
    const { x, y, width, height } = block.box;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        expected[(y - here.y + row) * here.width + x - here.x + column] = packedAt(golden, there.box.x + column, there.box.y + row);
      }
    }
  }
  return expected;
}

/** Calls back with each pixel of a hunk, past spacing, that isn't what its account expected. */
export function forEachUnexplained(
  current: RawImage,
  here: BoundingBox,
  { spacing, expected }: { readonly spacing: ReadonlySet<number>; readonly expected: Int32Array },
  visit: (x: number, y: number, wanted: number, actual: number) => void,
): void {
  for (let row = 0; row < here.height; row++) {
    const y = here.y + row;
    if (spacing.has(y)) continue;
    for (let column = 0; column < here.width; column++) {
      const x = here.x + column;
      const wanted = expected[row * here.width + column]!;
      const actual = packedAt(current, x, y);
      if (wanted !== actual) visit(x, y, wanted, actual);
    }
  }
}

function unexplained(current: RawImage, here: BoundingBox, spacing: ReadonlySet<number>, expected: Int32Array, goldenOnly: number): number {
  let count = goldenOnly;
  forEachUnexplained(current, here, { spacing, expected }, () => {
    count += 1;
  });
  return count;
}

export interface Explanation extends Account {
  /** Rows of the current image that are spacing. */
  readonly spacing: ReadonlySet<number>;
  readonly goldenSpacingRows: number;
  readonly changedPixels: number;
  readonly kind: HunkKind;
}

/**
 * Accounts for each hunk's difference both ways, and keeps whichever leaves less unexplained. Blocks
 * pair across hunks, since what moved sideways is two hunks: one that lost it, one that gained it.
 * A hunk compared in place gives up its pairs, since its pixels are already judged where they are,
 * which can leave another hunk worse off, so this repeats until every hunk that's left still gains.
 */
export function explainHunks(current: RawImage, golden: RawImage, hunks: readonly BoxPair[]): readonly Explanation[] {
  const background = backgroundOf(golden);
  const facts = hunks.map((hunk, index) => {
    const spacing = spacingRows(current, hunk.current, hunk.current.height - hunk.golden.height, background);
    const goldenSpacing = spacingRows(golden, hunk.golden, hunk.golden.height - hunk.current.height, background);
    const inPlace = comparedInPlace(golden, hunk, spacing, goldenSpacing);
    return {
      spacing,
      goldenSpacingRows: goldenSpacing.size,
      inPlace,
      inPlaceCost: unexplained(current, hunk.current, spacing, inPlace.expected, inPlace.goldenOnly),
      heres: blocksOf(current, hunk.current, spacing, background, index),
      theres: blocksOf(golden, hunk.golden, goldenSpacing, background, index),
    };
  });

  let rebuilding = hunks.map((_, index) => index);
  let claimed = new Map<number, { readonly account: Account; readonly cost: number }>();
  for (;;) {
    const pairs = pairUp(rebuilding.flatMap((index) => facts[index]!.heres), rebuilding.flatMap((index) => facts[index]!.theres));
    const touching = new Map<number, Pair[]>(rebuilding.map((index) => [index, []]));
    for (const pair of pairs) {
      touching.get(pair.here.hunk)!.push(pair);
      if (pair.there.hunk !== pair.here.hunk) touching.get(pair.there.hunk)!.push(pair);
    }
    claimed = new Map();
    for (const index of rebuilding) {
      const { spacing, inPlaceCost, theres } = facts[index]!;
      const here = hunks[index]!.current;
      const own = touching.get(index)!;
      const moves = movesOf(hunks[index]!, index, own, theres);
      if (moves.moved.length + moves.movedOut.length === 0) continue;
      const expected = rebuilt(golden, here, index, own, background);
      const cost = unexplained(current, here, spacing, expected, moves.goldenOnly);
      if (cost < inPlaceCost) claimed.set(index, { account: { ...moves, expected }, cost });
    }
    if (claimed.size === rebuilding.length) break;
    rebuilding = [...claimed.keys()];
  }

  return facts.map(({ spacing, goldenSpacingRows, inPlace, inPlaceCost }, index) => {
    const { account, cost } = claimed.get(index) ?? { account: inPlace, cost: inPlaceCost };
    const kind = cost > 0 ? "changed" : account.moved.length + account.movedOut.length > 0 ? "moved" : "spacing";
    return { ...account, spacing, goldenSpacingRows, changedPixels: cost, kind };
  });
}
