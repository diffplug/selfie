import type { RawImage } from "selfie-store";
import type { BoundingBox, ChangedRegion, PixelDiff } from "selfie-ui/app";
import { encodePng } from "./png.ts";

export type { BoundingBox, ChangedRegion, PixelDiff };

const HIGHLIGHT = [255, 0, 80] as const;
// An unchanged pixel fades into gray from this level to white, so the page stays readable
// behind the highlight and no color in it can be mistaken for one.
const FADED_FLOOR = 190;

function fade(from: Uint8Array, out: Uint8Array, at: number): void {
  const luma = (from[at]! * 77 + from[at + 1]! * 150 + from[at + 2]! * 29) >> 8;
  const faded = FADED_FLOOR + ((luma * (255 - FADED_FLOOR)) >> 8);
  out[at] = faded;
  out[at + 1] = faded;
  out[at + 2] = faded;
}

function highlight(out: Uint8Array, at: number): void {
  out[at] = HIGHLIGHT[0];
  out[at + 1] = HIGHLIGHT[1];
  out[at + 2] = HIGHLIGHT[2];
}

function rowsMatch(current: RawImage, currentRow: number, golden: RawImage, goldenRow: number): boolean {
  const bytes = current.width * 3;
  const a = current.pixels.subarray(currentRow * bytes, (currentRow + 1) * bytes);
  const b = golden.pixels.subarray(goldenRow * bytes, (goldenRow + 1) * bytes);
  return Buffer.compare(a, b) === 0;
}

/**
 * Which rows of each image correspond, and differ: from the edges inward, what's left between the
 * rows that match from the top and from the bottom. So today there's at most one region, and with
 * different widths no row can match, so it's the whole of both images.
 */
function alignRows(current: RawImage, golden: RawImage): readonly ChangedRegion[] {
  const shared = Math.min(current.height, golden.height);
  let above = 0;
  let below = 0;
  if (current.width === golden.width) {
    while (above < shared && rowsMatch(current, above, golden, above)) above += 1;
    while (below < shared - above && rowsMatch(current, current.height - 1 - below, golden, golden.height - 1 - below)) below += 1;
  }
  const region = {
    current: { y: above, height: current.height - above - below },
    golden: { y: above, height: golden.height - above - below },
  };
  return region.current.height === 0 && region.golden.height === 0 ? [] : [region];
}

/**
 * Compares two images, and draws the current one faded with what changed highlighted. Within a
 * region, pixels compare from its top left, and anything only one image has is changed.
 */
export function diffImages(current: RawImage, golden: RawImage): { readonly diff: PixelDiff; readonly highlighted: RawImage } {
  const { width, height, pixels: a } = current;
  const b = golden.pixels;
  const out = new Uint8Array(a.length);
  for (let at = 0; at < a.length; at += 3) fade(a, out, at);

  let changedPixels = 0;
  let maxChannelDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let firstChanged: { x: number; y: number } | null = null;
  const mark = (x: number, y: number) => {
    firstChanged ??= { x, y };
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const regions = alignRows(current, golden);
  for (const region of regions) {
    const sharedRows = Math.min(region.current.height, region.golden.height);
    let changedHere = 0;
    for (let row = 0; row < region.current.height; row++) {
      const y = region.current.y + row;
      const goldenRowStart = row < sharedRows ? (region.golden.y + row) * golden.width * 3 : -1;
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3;
        let delta = 0;
        if (goldenRowStart >= 0 && x < golden.width) {
          const goldenAt = goldenRowStart + x * 3;
          delta = Math.max(Math.abs(a[at]! - b[goldenAt]!), Math.abs(a[at + 1]! - b[goldenAt + 1]!), Math.abs(a[at + 2]! - b[goldenAt + 2]!));
          if (delta === 0) continue;
        }
        changedHere += 1;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
        mark(x, y);
        highlight(out, at);
      }
    }
    // What only the golden has here: rows past the current's, and columns past its width.
    const goldenOnly = (region.golden.height - sharedRows) * golden.width + sharedRows * Math.max(0, golden.width - width);
    changedPixels += changedHere + goldenOnly;
    if (changedHere === 0 && goldenOnly > 0) {
      // Nothing here changed, since something was only removed, so mark the seam it left.
      const seam = Math.min(region.current.y, height - 1);
      for (let x = 0; x < width; x++) {
        mark(x, seam);
        highlight(out, (seam * width + x) * 3);
      }
    }
  }

  return {
    diff: {
      current: { width, height },
      golden: { width: golden.width, height: golden.height },
      regions,
      changedPixels,
      totalPixels: Math.max(width * height, golden.width * golden.height),
      boundingBox: firstChanged === null ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      firstChanged,
      maxChannelDelta,
    },
    highlighted: { width, height, pixels: out },
  };
}

/** Two stored images compared: what `selfie review` exports, and what the review UI serves. */
export async function diffToPng(current: RawImage, golden: RawImage): Promise<{ readonly diff: PixelDiff; readonly png: Uint8Array }> {
  const { diff, highlighted } = diffImages(current, golden);
  return { diff, png: await encodePng(highlighted) };
}
