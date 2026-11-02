import type { RawImage } from "selfie-store";
import type { BoundingBox, ChangedRegion, PixelDiff, RegionKind } from "selfie-ui/app";
import { explainRegions, forEachUnexplained } from "./explain.ts";
import { encodePng } from "./png.ts";
import { findRegions } from "./regions.ts";

export type { BoundingBox, PixelDiff } from "selfie-ui/app";

type Color = readonly [number, number, number];

const COLORS: Readonly<Record<RegionKind, Color>> = { changed: [255, 0, 80], moved: [9, 105, 218], spacing: [255, 214, 102] };
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

function paint(out: Uint8Array, at: number, [red, green, blue]: Color): void {
  out[at] = red;
  out[at + 1] = green;
  out[at + 2] = blue;
}

/** Over what's faded, so what moved stays readable. */
function tintBox(out: Uint8Array, imageWidth: number, { x, y, width, height }: BoundingBox): void {
  const [red, green, blue] = COLORS.moved;
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      const at = (row * imageWidth + column) * 3;
      out[at] = (out[at]! * 3 + red) >> 2;
      out[at + 1] = (out[at + 1]! * 3 + green) >> 2;
      out[at + 2] = (out[at + 2]! * 3 + blue) >> 2;
    }
  }
}

/**
 * Compares two images, and draws the current one faded, with what changed highlighted, what moved
 * tinted, and spacing marked. See `explainRegions` for how each is told apart.
 */
export function diffImages(current: RawImage, golden: RawImage): { readonly diff: PixelDiff; readonly highlighted: RawImage } {
  const { width, height, pixels: a } = current;
  const out = new Uint8Array(a.length);
  for (let at = 0; at < a.length; at += 3) fade(a, out, at);

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

  const found = findRegions(current, golden);
  const explanations = explainRegions(current, golden, found);
  let changedPixels = 0;
  let movedPixels = 0;
  let spacingPixels = 0;
  const regions = found.map((region, index): ChangedRegion => {
    const { current: here, golden: there } = region;
    const explanation = explanations[index]!;
    const { moved, movedOut, goldenOnly, spacing, goldenSpacingRows, kind } = explanation;

    for (const { current: block } of moved) {
      movedPixels += block.width * block.height;
      tintBox(out, width, block);
    }
    for (const left of movedOut) tintBox(out, width, left);
    for (const y of spacing) {
      for (let x = here.x; x < here.x + here.width; x++) paint(out, (y * width + x) * 3, COLORS.spacing);
    }
    forEachUnexplained(current, here, explanation, (x, y, wanted, actual) => {
      if (wanted >= 0) {
        const delta = Math.max(Math.abs((wanted >> 16) - (actual >> 16)), Math.abs(((wanted >> 8) & 255) - ((actual >> 8) & 255)), Math.abs((wanted & 255) - (actual & 255)));
        if (delta > maxChannelDelta) maxChannelDelta = delta;
      }
      mark(x, y);
      paint(out, (y * width + x) * 3, COLORS.changed);
    });

    spacingPixels += spacing.size * here.width + goldenSpacingRows * there.width;
    changedPixels += explanation.changedPixels;
    if (explanation.changedPixels === goldenOnly && moved.length === 0 && (kind !== "spacing" || goldenSpacingRows > 0)) {
      // Nothing here is different, since something was only taken away, so mark the seam it left.
      const seam = Math.min(here.y, height - 1);
      const from = here.width === 0 ? 0 : here.x;
      const to = here.width === 0 ? width : here.x + here.width;
      for (let x = from; x < to; x++) {
        if (kind === "changed") mark(x, seam);
        paint(out, (seam * width + x) * 3, COLORS[kind]);
      }
    }
    return { ...region, kind, changedPixels: explanation.changedPixels, moved };
  });

  // With nothing really changed, the box is what a person should look at: what moved or grew.
  if (firstChanged === null) {
    for (const { current: here } of regions) {
      mark(here.x, Math.min(here.y, height - 1));
      mark(here.x + Math.max(here.width, 1) - 1, Math.min(here.y + Math.max(here.height, 1) - 1, height - 1));
    }
  }

  return {
    diff: {
      current: { width, height },
      golden: { width: golden.width, height: golden.height },
      regions,
      changedPixels,
      movedPixels,
      spacingPixels,
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
