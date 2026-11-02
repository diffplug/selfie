import type { RawImage } from "selfie-store";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PixelDiff =
  | {
      readonly kind: "pixels";
      readonly changedPixels: number;
      readonly totalPixels: number;
      /** Null only if the images are identical, which a `changed` snapshot never is. */
      readonly boundingBox: BoundingBox | null;
      /** The largest difference in any one channel of any pixel, 1 to 255. */
      readonly maxChannelDelta: number;
    }
  | {
      /** Nothing lines up, so there are no pixels to compare and no diff image. */
      readonly kind: "size-differs";
      readonly current: { readonly width: number; readonly height: number };
      readonly golden: { readonly width: number; readonly height: number };
    };

const HIGHLIGHT = [255, 0, 80] as const;
// An unchanged pixel fades into gray from this level to white, so the page stays readable
// behind the highlight and no color in it can be mistaken for one.
const FADED_FLOOR = 190;

/** Compares two images, and draws the current one faded with its changed pixels highlighted. */
export function diffImages(
  current: RawImage,
  golden: RawImage,
): { readonly diff: PixelDiff; readonly highlighted: RawImage | null } {
  const { width, height } = current;
  if (width !== golden.width || height !== golden.height) {
    return {
      diff: {
        kind: "size-differs",
        current: { width, height },
        golden: { width: golden.width, height: golden.height },
      },
      highlighted: null,
    };
  }

  const a = current.pixels;
  const b = golden.pixels;
  const out = new Uint8Array(a.length);
  let changedPixels = 0;
  let maxChannelDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0, at = 0; y < height; y++) {
    for (let x = 0; x < width; x++, at += 3) {
      const red = a[at]!;
      const green = a[at + 1]!;
      const blue = a[at + 2]!;
      const delta = Math.max(Math.abs(red - b[at]!), Math.abs(green - b[at + 1]!), Math.abs(blue - b[at + 2]!));
      if (delta === 0) {
        const luma = (red * 77 + green * 150 + blue * 29) >> 8;
        const faded = FADED_FLOOR + ((luma * (255 - FADED_FLOOR)) >> 8);
        out[at] = faded;
        out[at + 1] = faded;
        out[at + 2] = faded;
      } else {
        changedPixels += 1;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        out[at] = HIGHLIGHT[0];
        out[at + 1] = HIGHLIGHT[1];
        out[at + 2] = HIGHLIGHT[2];
      }
    }
  }
  return {
    diff: {
      kind: "pixels",
      changedPixels,
      totalPixels: width * height,
      boundingBox:
        changedPixels === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      maxChannelDelta,
    },
    highlighted: { width, height, pixels: out },
  };
}
