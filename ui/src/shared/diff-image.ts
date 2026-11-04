// How a diff image is drawn, for the differ that draws one, and a page that redraws part of one.
import type { BoundingBox } from "./api.ts";

// An unchanged pixel fades into gray from this level to white, so the page stays readable
// behind the highlight and no color in it can be mistaken for one.
const FADED_FLOOR = 190;

/** What didn't change, at any stride. */
export function fade(from: ArrayLike<number>, out: { [index: number]: number }, at: number): void {
  const luma = (from[at]! * 77 + from[at + 1]! * 150 + from[at + 2]! * 29) >> 8;
  const faded = FADED_FLOOR + ((luma * (255 - FADED_FLOOR)) >> 8);
  out[at] = faded;
  out[at + 1] = faded;
  out[at + 2] = faded;
}

/** The row marking where something was only taken away, for a hunk at this box of the current image. */
export const seamOf = ({ x, y, width }: BoundingBox, image: { readonly width: number; readonly height: number }): BoundingBox => ({
  x: width === 0 ? 0 : x,
  y: Math.min(y, image.height - 1),
  width: width === 0 ? image.width : width,
  height: 1,
});
