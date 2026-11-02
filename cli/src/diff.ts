import type { RawImage } from "selfie-store";
import type { PixelDiff } from "selfie-ui/app";
import { encodePng } from "./png.ts";
import { findRegions } from "./regions.ts";

export type { BoundingBox, PixelDiff } from "selfie-ui/app";

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
    if (firstChanged === null || y < firstChanged.y || (y === firstChanged.y && x < firstChanged.x)) firstChanged = { x, y };
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const regions = findRegions(current, golden);
  for (const { current: here, golden: there } of regions) {
    const sharedRows = Math.min(here.height, there.height);
    const sharedColumns = Math.min(here.width, there.width);
    let changedHere = 0;
    for (let row = 0; row < here.height; row++) {
      for (let column = 0; column < here.width; column++) {
        const x = here.x + column;
        const y = here.y + row;
        const at = (y * width + x) * 3;
        let delta = 0;
        if (row < sharedRows && column < sharedColumns) {
          const goldenAt = ((there.y + row) * golden.width + there.x + column) * 3;
          delta = Math.max(Math.abs(a[at]! - b[goldenAt]!), Math.abs(a[at + 1]! - b[goldenAt + 1]!), Math.abs(a[at + 2]! - b[goldenAt + 2]!));
          if (delta === 0) continue;
        }
        changedHere += 1;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
        mark(x, y);
        highlight(out, at);
      }
    }
    // What only the golden has here.
    const goldenOnly = there.width * there.height - sharedRows * sharedColumns;
    changedPixels += changedHere + goldenOnly;
    if (changedHere === 0 && goldenOnly > 0) {
      // Nothing here changed, since something was only removed, so mark the seam it left.
      const seam = Math.min(here.y, height - 1);
      const from = here.width === 0 ? 0 : here.x;
      const to = here.width === 0 ? width : here.x + here.width;
      for (let x = from; x < to; x++) {
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
