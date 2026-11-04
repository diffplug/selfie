// Finding deltas, and drawing what accepting them leaves. All of it happens here: which are accepted
// is this browser's, for this batch, and what reaches the server is only an approval of a whole image.
import { useEffect, useMemo, useState } from "react";
import { mapConcurrently, sha256, toHex } from "selfie-store";
import type { BoundingBox, ChangedHunk, PixelDiff, RenderRow } from "../shared/api.ts";
import { acceptedDeltas, canApply, finishedBy, hunksAccepted, isComparable, offeredDeltas, patchGolden, repeatedSizes, sizeKey, type Comparable, type Delta, type GoldenPatch, type ScannedRow } from "../shared/deltas.ts";
import { fade } from "../shared/diff-image.ts";
import { isEmptyBox } from "../shared/hunks.ts";
import { diffImageUrl, fetchDiff, imageUrl } from "./api.ts";
import { useFetched } from "./hooks.ts";

/** Enough to go quickly, and few enough to leave room for whatever else the page is asking for. */
const AT_ONCE = 4;
/** Each holds two images, and this is plenty for what's on screen, what's next, and going back a little. */
const PATCHES_KEPT = 16;

const pairOf = ({ imageHash, goldenHash }: Comparable) => `${imageHash}/${goldenHash}`;

/**
 * What's been worked out, by content, so it never changes. At most one of each is on its way, and
 * it's never called off, since whoever asks next wants the same answer.
 */
class Known<Value> {
  private readonly held = new Map<string, Value>();
  private readonly coming = new Map<string, Promise<Value>>();
  private readonly limit: number;
  private readonly dropped: (value: Value) => void;

  constructor(limit = Infinity, dropped: (value: Value) => void = () => undefined) {
    this.limit = limit;
    this.dropped = dropped;
  }

  /** Counts as using it, so what's on screen is never the oldest. */
  peek(id: string): Value | undefined {
    const value = this.held.get(id);
    if (value !== undefined) {
      this.held.delete(id);
      this.held.set(id, value);
    }
    return value;
  }

  private hold(id: string, value: Value): Value {
    this.held.set(id, value);
    if (this.held.size > this.limit) {
      const [oldest, old] = this.held.entries().next().value as [string, Value];
      this.held.delete(oldest);
      this.dropped(old);
    }
    return value;
  }

  of(id: string, work: () => Promise<Value>): Promise<Value> {
    const value = this.peek(id);
    if (value !== undefined) return Promise.resolve(value);
    const coming = this.coming.get(id) ?? work().then((done) => this.hold(id, done)).finally(() => this.coming.delete(id));
    this.coming.set(id, coming);
    return coming;
  }
}

export interface PatchedImages {
  readonly golden: string;
  readonly diff: string;
}

export interface PatchedGolden {
  readonly images: PatchedImages;
  /** What's left, against `images.golden`. */
  readonly diff: PixelDiff;
}

const knownDiffs = new Known<PixelDiff>();
const knownKeys = new Known<readonly (string | null)[]>();
const knownPatches = new Known<PatchedGolden>(PATCHES_KEPT, ({ images }) => {
  URL.revokeObjectURL(images.golden);
  URL.revokeObjectURL(images.diff);
});

async function decoded(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The server answered ${response.status} for ${url}.`);
  return createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

async function withImages<T>({ imageHash, goldenHash }: Comparable, work: (current: ImageBitmap, golden: ImageBitmap) => Promise<T>): Promise<T> {
  const [current, golden] = await Promise.all([decoded(imageUrl(imageHash)), decoded(imageUrl(goldenHash))]);
  try {
    return await work(current, golden);
  } finally {
    current.close();
    golden.close();
  }
}

function pixelsIn(image: ImageBitmap, { x, y, width, height }: BoundingBox): ImageData {
  const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

const digest = async (image: ImageBitmap, box: BoundingBox) => (isEmptyBox(box) ? "" : toHex(await sha256(new Uint8Array(pixelsIn(image, box).data.buffer))));

async function keyOf(hunk: ChangedHunk, current: ImageBitmap, golden: ImageBitmap): Promise<string> {
  const [before, after] = await Promise.all([digest(golden, hunk.golden), digest(current, hunk.current)]);
  return `${sizeKey(hunk)}:${before}:${after}`;
}

/** Always of these two images. A review's stats are by story, and a later approval can change what it's compared with, so they could be another pair's. */
const diffOf = (row: Comparable) => knownDiffs.of(pairOf(row), () => fetchDiff(row.imageHash, row.goldenHash));

const hunkKeys = (row: Comparable) =>
  knownKeys.of(pairOf(row), async () => {
    const diff = await diffOf(row);
    return withImages(row, (current, golden) => Promise.all(diff.hunks.map((hunk) => (canApply(hunk, diff) ? keyOf(hunk, current, golden) : null))));
  });

/** What each of a story's hunks holds, for saying which are accepted. */
export const deltaKeysOf = (row: RenderRow) => (isComparable(row) ? hunkKeys(row) : Promise.resolve([]));

/** The diff image with what's settled drawn as what didn't change, which the server's can't know. */
async function settledDiffImage({ imageHash, goldenHash }: Comparable, { settled }: GoldenPatch, current: ImageBitmap): Promise<Blob> {
  const image = await decoded(diffImageUrl(imageHash, goldenHash));
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  image.close();
  for (const box of settled) {
    const pixels = pixelsIn(current, box);
    for (let at = 0; at < pixels.data.length; at += 4) fade(pixels.data, pixels.data, at);
    context.putImageData(pixels, box.x, box.y);
  }
  return canvas.convertToBlob({ type: "image/png" });
}

const drawPatch = (row: Comparable, patch: GoldenPatch): Promise<PatchedImages> =>
  withImages(row, async (current, golden) => {
    const canvas = new OffscreenCanvas(patch.diff.golden.width, patch.diff.golden.height);
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    for (const { from, box, toX, toY } of patch.blits) {
      context.drawImage(from === "golden" ? golden : current, box.x, box.y, box.width, box.height, toX, toY, box.width, box.height);
    }
    const [goldenBlob, diffBlob] = await Promise.all([canvas.convertToBlob({ type: "image/png" }), settledDiffImage(row, patch, current)]);
    return { golden: URL.createObjectURL(goldenBlob), diff: URL.createObjectURL(diffBlob) };
  });

const patchId = (row: Comparable, hunks: readonly number[]) => `${pairOf(row)}:${hunks.join()}`;

async function patchFor(row: Comparable, accepted: ReadonlySet<string>): Promise<PatchedGolden | null> {
  const [diff, keys] = await Promise.all([diffOf(row), hunkKeys(row)]);
  const hunks = hunksAccepted(keys, accepted);
  if (hunks.length === 0) return null;
  return knownPatches.of(patchId(row, hunks), async () => {
    const patch = patchGolden(diff, hunks);
    return { images: await drawPatch(row, patch), diff: patch.diff };
  });
}

/** Already drawn, so moving to a story that has been shown or got ready never shows what it looked like before. */
function patchKnown(row: Comparable, accepted: ReadonlySet<string>): PatchedGolden | null {
  const keys = knownKeys.peek(pairOf(row));
  return keys === undefined ? null : (knownPatches.peek(patchId(row, hunksAccepted(keys, accepted))) ?? null);
}

/** A story's golden with what's been accepted drawn onto it, or null with nothing to draw, or until it's drawn. */
export function usePatchedGolden(row: RenderRow | null, accepted: ReadonlySet<string>): PatchedGolden | null {
  const comparable = row !== null && accepted.size > 0 && isComparable(row) ? row : null;
  const id = comparable === null ? null : `${pairOf(comparable)}:${[...accepted].sort().join()}`;
  const { data } = useFetched(id, () => patchFor(comparable!, accepted));
  return useMemo(() => data ?? (comparable === null ? null : patchKnown(comparable, accepted)), [data, id]);
}

/** Has the story after this one drawn before someone gets to it. */
export function prepareNext(row: RenderRow, accepted: ReadonlySet<string>): void {
  if (accepted.size > 0 && isComparable(row)) patchFor(row, accepted).catch(() => undefined);
}

export interface DeltaState {
  /** How far through looking for them, in percent, or null once that's done. */
  readonly progress: number | null;
  readonly accepted: ReadonlySet<string>;
  readonly offers: readonly Delta[];
  /** What's been accepted, whichever stories still have it to show. */
  readonly taken: readonly Delta[];
  /** The undecided stories that accepting this leaves nothing different in. */
  readonly finishes: (delta: Delta) => readonly RenderRow[];
  readonly accept: (delta: Delta) => void;
  readonly undo: (delta: Delta) => void;
}

const storageKey = (batchId: string) => `selfie:accepted-deltas:${batchId}`;

function readAccepted(batchId: string): ReadonlySet<string> {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(storageKey(batchId)) ?? "[]");
    return new Set(Array.isArray(held) ? held.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/** Which deltas are accepted on this batch, kept in this browser, and the same in all its tabs. */
function useAcceptedKeys(batchId: string) {
  const [accepted, setAccepted] = useState(() => readAccepted(batchId));
  useEffect(() => {
    const onStorage = ({ key }: StorageEvent) => {
      if (key === storageKey(batchId)) setAccepted(readAccepted(batchId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [batchId]);
  const save = (next: ReadonlySet<string>) => {
    localStorage.setItem(storageKey(batchId), JSON.stringify([...next]));
    setAccepted(next);
  };
  return [accepted, save] as const;
}

/**
 * Every changed story's hunks and what's in them. `looking` is whether to go on finding that, since
 * only the batch's own screen shows what it finds, and a story's images come first. What's found stays.
 */
export function useDeltas(batchId: string, rows: readonly RenderRow[] | undefined, looking: boolean): DeltaState {
  const [accepted, setAccepted] = useAcceptedKeys(batchId);
  // How many times it's finished looking, since what it found is in what's known.
  const [looked, setLooked] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const pairs = useMemo(() => (rows ?? []).filter(isComparable), [rows]);
  const pairsId = useMemo(() => pairs.map(pairOf).join(), [pairs]);

  useEffect(() => {
    if (!looking || pairs.length === 0) {
      setProgress(null);
      return;
    }
    let stopped = false;
    /** One half of the way there. A whole percent, so the page only draws again when that changes. One that can't be compared just can't be part of a delta. */
    const halfway = async (items: readonly Comparable[], work: (row: Comparable) => Promise<unknown>, from: number) => {
      let done = 0;
      await mapConcurrently(items, AT_ONCE, async (row) => {
        if (stopped) return;
        await work(row).catch(() => undefined);
        if (!stopped) setProgress(from + Math.round((++done / items.length) * 50));
      });
    };
    void (async () => {
      setProgress(0);
      await halfway(pairs, diffOf, 0);
      const diffOfRow = (row: Comparable) => knownDiffs.peek(pairOf(row));
      const sizes = repeatedSizes(pairs.flatMap((row) => diffOfRow(row) ?? []));
      await halfway(pairs.filter((row) => diffOfRow(row)?.hunks.some((hunk) => sizes.has(sizeKey(hunk)))), hunkKeys, 50);
      if (stopped) return;
      setLooked((times) => times + 1);
      setProgress(null);
    })();
    return () => {
      stopped = true;
    };
  }, [looking, pairsId]);

  const scans = useMemo(
    () =>
      pairs.flatMap((row): ScannedRow[] => {
        const diff = knownDiffs.peek(pairOf(row));
        const keys = knownKeys.peek(pairOf(row));
        return diff === undefined || keys === undefined ? [] : [{ row, diff, keys }];
      }),
    [pairs, looked],
  );
  const offers = useMemo(() => offeredDeltas(scans, accepted), [scans, accepted]);
  const taken = useMemo(() => acceptedDeltas(scans, accepted), [scans, accepted]);
  return {
    progress,
    accepted,
    offers,
    taken,
    finishes: ({ key }) => finishedBy(scans, new Set([...accepted, key])),
    accept: ({ key }) => setAccepted(new Set([...accepted, key])),
    undo: ({ key }) => setAccepted(new Set([...accepted].filter((held) => held !== key))),
  };
}
