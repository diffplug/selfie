// A delta is one change repeated across stories: hunks whose two sides are the same size and hold the
// same pixels, wherever they sit. Accepting one redraws its hunks onto the golden, in the browser and
// nowhere else, so what's left to look at is smaller. Pure, so a test needs no browser.
import type { BoundingBox, ChangedHunk, PixelDiff, RenderRow } from "./api.ts";
import { seamOf } from "./diff-image.ts";
import { hull, isEmptyBox } from "./hunks.ts";

/** Fewer than this isn't worth stopping for, since looking at each is about as quick. */
export const MIN_AFFECTED = 3;

/** A changed render with both its images, which is all a delta can be between. */
export type Comparable = RenderRow & { readonly imageHash: string; readonly goldenHash: string };
export const isComparable = (row: RenderRow): row is Comparable => row.state === "changed" && row.imageHash !== null && row.goldenHash !== null;

/** One story's hunks. A key says what a hunk's pixels are, or is null if it can't be redrawn on its own. */
export interface ScannedRow {
  readonly row: Comparable;
  readonly diff: PixelDiff;
  /** By hunk. */
  readonly keys: readonly (string | null)[];
}

/** Where one side of a delta is, in one story's image: every place it has it, which accepting covers, in the order of its hunks. */
export interface DeltaSide {
  readonly hash: string;
  readonly boxes: readonly BoundingBox[];
  /** The whole image's, to crop it. */
  readonly image: { readonly width: number; readonly height: number };
}

/** One story a delta is in. */
export interface DeltaExample {
  readonly story: string;
  readonly golden: DeltaSide;
  readonly current: DeltaSide;
}

export interface Delta {
  readonly key: string;
  readonly kind: ChangedHunk["kind"];
  /** Each story once, in the order they're listed. */
  readonly examples: readonly DeltaExample[];
}

export const sizeKey = ({ golden, current }: ChangedHunk) => `${golden.width}x${golden.height}>${current.width}x${current.height}`;

const sameSize = ({ golden, current }: ChangedHunk) => golden.width === current.width && golden.height === current.height;

/**
 * A hunk of one size stays in its place, and one that changes height has to move all that's below it,
 * which takes the image's whole width. A narrower one only balances out with others in its column.
 */
export const canApply = (hunk: ChangedHunk, { golden, current }: Pick<PixelDiff, "golden" | "current">) =>
  sameSize(hunk) || (hunk.golden.x === 0 && hunk.golden.width === golden.width && hunk.current.x === 0 && hunk.current.width === current.width);

/** Only sizes enough stories share are worth decoding any images for. */
export function repeatedSizes(diffs: readonly PixelDiff[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const diff of diffs) {
    const sizes = new Set(diff.hunks.filter((hunk) => canApply(hunk, diff)).map(sizeKey));
    for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= MIN_AFFECTED).map(([size]) => size));
}

const areaOf = ({ width, height }: BoundingBox) => width * height;

const sideWith = (box: BoundingBox, hash: string, image: DeltaSide["image"], known: DeltaSide | undefined): DeltaSide => ({ hash, image, boxes: [...(known?.boxes ?? []), box] });

/** Whichever `wanted` picks, most stories first, and then the largest, so the order never depends on the list's. */
function deltasIn(scans: readonly ScannedRow[], wanted: (key: string) => boolean): Delta[] {
  const found = new Map<string, { readonly kind: Delta["kind"]; readonly examples: Map<string, DeltaExample> }>();
  for (const { row, diff, keys } of scans) {
    diff.hunks.forEach((hunk, index) => {
      const key = keys[index];
      if (key === null || key === undefined || !wanted(key)) return;
      const { examples } = found.get(key) ?? found.set(key, { kind: hunk.kind, examples: new Map() }).get(key)!;
      const known = examples.get(row.story);
      examples.set(row.story, {
        story: row.story,
        golden: sideWith(hunk.golden, row.goldenHash, diff.golden, known?.golden),
        current: sideWith(hunk.current, row.imageHash, diff.current, known?.current),
      });
    });
  }
  const size = ({ examples }: Delta) => areaOf(examples[0]!.golden.boxes[0]!) + areaOf(examples[0]!.current.boxes[0]!);
  return [...found]
    .map(([key, { kind, examples }]): Delta => ({ key, kind, examples: [...examples.values()] }))
    .sort((p, q) => q.examples.length - p.examples.length || size(q) - size(p) || (p.key < q.key ? -1 : 1));
}

const isUndecided = ({ row }: ScannedRow) => row.decision === null;

/** What to offer: only undecided stories are affected, since an image with a decision has had its look. */
export const offeredDeltas = (scans: readonly ScannedRow[], accepted: ReadonlySet<string>): readonly Delta[] =>
  deltasIn(scans.filter(isUndecided), (key) => !accepted.has(key)).filter(({ examples }) => examples.length >= MIN_AFFECTED);

export const acceptedDeltas = (scans: readonly ScannedRow[], accepted: ReadonlySet<string>): readonly Delta[] => deltasIn(scans, (key) => accepted.has(key));

/** The undecided stories with nothing left once these are accepted, which is what an approval is for. */
export const finishedBy = (scans: readonly ScannedRow[], accepted: ReadonlySet<string>): readonly RenderRow[] =>
  scans.filter((scan) => isUndecided(scan) && scan.keys.length > 0 && scan.keys.every((key) => key !== null && accepted.has(key))).map(({ row }) => row);

/** The hunks of a story that these say to accept. */
export const hunksAccepted = (keys: readonly (string | null)[], accepted: ReadonlySet<string>): readonly number[] =>
  keys.flatMap((key, index) => (key !== null && accepted.has(key) ? [index] : []));

/** Pixels to copy from one image onto the patched golden, at their own size. */
export interface Blit {
  readonly from: "golden" | "current";
  readonly box: BoundingBox;
  readonly toX: number;
  readonly toY: number;
}

export interface GoldenPatch {
  /** In order, each over the last. */
  readonly blits: readonly Blit[];
  /** The hunks left, against the patched golden, which is `diff.golden`'s size. */
  readonly diff: PixelDiff;
  /** What the diff image marks that's no longer a difference, in the current image. */
  readonly settled: readonly BoundingBox[];
}

/**
 * The golden with these hunks redrawn from the current image. Everything outside a hunk matches, so
 * what differs afterward is exactly the other hunks, with no need to compare any pixels again, and
 * accepting every one gives the current image itself.
 */
export function patchGolden(diff: PixelDiff, accepted: readonly number[]): GoldenPatch {
  const taken = new Set(accepted);
  const hunks = diff.hunks.filter((_, index) => taken.has(index));
  const splices = hunks.filter((hunk) => !sameSize(hunk)).sort((p, q) => p.golden.y - q.golden.y);
  const width = splices.some(({ golden, current }) => golden.width !== current.width) ? diff.current.width : diff.golden.width;

  const blits: Blit[] = [];
  let from = 0;
  let to = 0;
  const copyGolden = (height: number) => {
    blits.push({ from: "golden", box: { x: 0, y: from, width: diff.golden.width, height }, toX: 0, toY: to });
    to += height;
  };
  for (const { golden, current } of splices) {
    copyGolden(golden.y - from);
    blits.push({ from: "current", box: current, toX: 0, toY: to });
    to += current.height;
    from = golden.y + golden.height;
  }
  copyGolden(diff.golden.height - from);

  // Where a row of the golden ends up, which only what's wholly above it can change.
  const moved = (y: number) => splices.reduce((sum, { golden, current }) => (golden.y + golden.height <= y ? sum + current.height - golden.height : sum), y);
  for (const hunk of hunks) {
    if (sameSize(hunk)) blits.push({ from: "current", box: hunk.current, toX: hunk.golden.x, toY: moved(hunk.golden.y) });
  }

  const left = diff.hunks
    .filter((_, index) => !taken.has(index))
    .map((hunk) => ({
      ...hunk,
      golden: { ...hunk.golden, y: moved(hunk.golden.y) },
      moved: hunk.moved.map((pair) => ({ ...pair, golden: { ...pair.golden, y: moved(pair.golden.y) } })),
    }));
  const first = left[0]?.current;
  return {
    blits: blits.filter(({ box }) => !isEmptyBox(box)),
    settled: hunks.map(({ current }) => (isEmptyBox(current) ? seamOf(current, diff.current) : current)),
    diff: {
      current: diff.current,
      golden: { width, height: to },
      hunks: left,
      changedPixels: left.reduce((sum, { changedPixels }) => sum + changedPixels, 0),
      movedPixels: left.reduce((sum, hunk) => sum + hunk.moved.reduce((blocks, { current }) => blocks + areaOf(current), 0), 0),
      // Only a hunk that's all spacing says how much it holds, so this leaves out any inside a changed hunk.
      spacingPixels: left.reduce((sum, { kind, golden, current }) => (kind === "spacing" ? sum + Math.abs(areaOf(golden) - areaOf(current)) : sum), 0),
      totalPixels: Math.max(diff.current.width * diff.current.height, width * to),
      boundingBox: left.length === 0 ? null : left.map(({ current }) => current).reduce(hull),
      firstChanged: first === undefined ? null : { x: first.x, y: first.y },
      // Which hunk had the largest isn't known, and saying nothing beats overstating it.
      maxChannelDelta: 0,
    },
  };
}
