/**
 * The one place that knows what format image files are in. Today that is PNG, a
 * lossless stand-in, and only the narrow form Chromium writes. The image hash never
 * sees any of this: it covers the canonical PAM of the decoded pixels.
 *
 * Written here rather than taken from a library because uploads are untrusted, and a
 * decoder must refuse what it can't decode exactly, which takes control of each chunk
 * and of the inflate. See `docs/specs/store.rationale.md` → Image decoding.
 */

import type { RawImage } from "./pam.ts";

/** A file was refused: it is corrupt, or it isn't a form the store accepts. */
export class ImageDecodeError extends Error {
  override readonly name = "ImageDecodeError";
}

/**
 * Decodes an image file to its exact 8-bit RGB. Throws `ImageDecodeError` for
 * anything else, including any transparency.
 */
export async function decodeImage(file: Uint8Array): Promise<RawImage> {
  if (hasPngSignature(file)) return decodePng(file);
  throw new ImageDecodeError("Refusing this file: it isn't a PNG, the one format the store accepts");
}

/**
 * The media type of the bytes `Store.getImage` returns, read from their first bytes.
 * That makes every blob record its own format, with nothing else to keep in step, so
 * a store can hold a second format if the stored one changes.
 */
export function imageMediaType(file: Uint8Array): string {
  if (hasPngSignature(file)) return "image/png";
  throw new RangeError("These bytes are not in a format the store writes");
}

function refuse(reason: string): never {
  throw new ImageDecodeError(`Refusing this PNG: ${reason}`);
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const RGB = 2;
const RGBA = 6;
const COLOR_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "grayscale",
  2: "RGB",
  3: "palette",
  4: "grayscale with alpha",
  6: "RGBA",
};

// A header of a few bytes decides how much is allocated, so it can't be unbounded.
const MAX_PIXELS = 100_000_000;
const CHUNK_OVERHEAD = 12;

interface Header {
  readonly width: number;
  readonly height: number;
  readonly colorType: typeof RGB | typeof RGBA;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

async function decodePng(png: Uint8Array): Promise<RawImage> {
  const { header, data } = readChunks(png);
  const { width, height, colorType } = header;
  const channels = colorType === RGB ? 3 : 4;
  const rowBytes = width * channels;
  const scanlines = await inflate(data, (rowBytes + 1) * height);

  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1) + 1;
    unfilterRow(scanlines, start, rowBytes, channels, y > 0);
    const row = scanlines.subarray(start, start + rowBytes);
    if (colorType === RGB) pixels.set(row, y * rowBytes);
    else copyDroppingOpaqueAlpha(row, pixels, y, width);
  }
  return { width, height, pixels };
}

/** Allows only IHDR, then IDAT chunks, then IEND, each with a good checksum. */
function readChunks(png: Uint8Array): { header: Header; data: readonly Uint8Array[] } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let header: Header | null = null;
  const data: Uint8Array[] = [];
  let offset = SIGNATURE.length;
  for (;;) {
    if (offset + CHUNK_OVERHEAD > png.length) refuse("it ends before its IEND chunk");
    const length = view.getUint32(offset);
    const end = offset + CHUNK_OVERHEAD + length;
    if (end > png.length) refuse("it ends inside a chunk");
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (view.getUint32(end - 4) !== crc32(png.subarray(offset + 4, end - 4))) {
      refuse(`its ${type} chunk fails its checksum`);
    }
    const body = png.subarray(offset + 8, end - 4);
    offset = end;

    if (header === null && type === "IHDR") {
      header = readHeader(body);
    } else if (header !== null && type === "IDAT") {
      data.push(body);
    } else if (header !== null && type === "IEND") {
      if (body.length !== 0) refuse("its IEND chunk is not empty");
      if (offset !== png.length) refuse("it has bytes after its IEND chunk");
      if (data.length === 0) refuse("it has no IDAT chunk");
      return { header, data };
    } else {
      refuse(`its ${type} chunk isn't allowed here: the store accepts only IHDR, IDAT, IEND, in that order`);
    }
  }
}

function readHeader(body: Uint8Array): Header {
  if (body.length !== 13) refuse(`its IHDR chunk is ${body.length} bytes, not 13`);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = body[8]!;
  const colorType = body[9]!;
  if (width === 0 || height === 0) refuse(`it is ${width}x${height}`);
  if (width * height > MAX_PIXELS) {
    refuse(`at ${width}x${height} it is over the limit of ${MAX_PIXELS} pixels`);
  }
  if (bitDepth !== 8 || (colorType !== RGB && colorType !== RGBA)) {
    const name = COLOR_TYPE_NAMES[colorType] ?? `color type ${colorType}`;
    refuse(`it is ${bitDepth}-bit ${name}, and the store accepts only 8-bit RGB or RGBA`);
  }
  if (body[10] !== 0) refuse(`its compression method ${body[10]} is not deflate`);
  if (body[11] !== 0) refuse(`its filter method ${body[11]} is not valid`);
  if (body[12] !== 0) refuse("it is interlaced, and the store accepts only non-interlaced files");
  return { width, height, colorType };
}

/**
 * Inflates into exactly `size` bytes. It stops as soon as the stream runs over, so a
 * small file can't make it inflate more than the header promised.
 */
async function inflate(deflated: readonly Uint8Array[], size: number): Promise<Uint8Array> {
  const stream = new Blob([...deflated] as Uint8Array<ArrayBuffer>[]).stream();
  const reader = stream.pipeThrough(new DecompressionStream("deflate")).getReader();
  const inflated = new Uint8Array(size);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > size) {
        void reader.cancel().catch(() => {});
        refuse(`its image data inflates to more than the expected ${size} bytes`);
      }
      inflated.set(value, length);
      length += value.length;
    }
  } catch (error) {
    if (error instanceof ImageDecodeError) throw error;
    refuse(`its image data is corrupt: ${String(error)}`);
  }
  if (length !== size) refuse(`its image data inflates to ${length} bytes, not ${size}`);
  return inflated;
}

/**
 * Reverses a row's filter in place. The row above it is unfiltered already. A loop
 * per filter, since calling a predictor per byte measured 3.5× slower.
 */
function unfilterRow(
  data: Uint8Array,
  start: number,
  rowBytes: number,
  bytesPerPixel: number,
  hasRowAbove: boolean,
): void {
  const filter = data[start - 1]!;
  const end = start + rowBytes;
  const above = rowBytes + 1;
  switch (filter) {
    case 0:
      break;
    case 1:
      for (let i = start + bytesPerPixel; i < end; i++) data[i] = data[i]! + data[i - bytesPerPixel]!;
      break;
    case 2:
      if (!hasRowAbove) break;
      for (let i = start; i < end; i++) data[i] = data[i]! + data[i - above]!;
      break;
    case 3:
      for (let i = start; i < end; i++) {
        const left = i - start >= bytesPerPixel ? data[i - bytesPerPixel]! : 0;
        data[i] = data[i]! + ((left + (hasRowAbove ? data[i - above]! : 0)) >> 1);
      }
      break;
    case 4:
      for (let i = start; i < end; i++) {
        const hasLeft = i - start >= bytesPerPixel;
        const left = hasLeft ? data[i - bytesPerPixel]! : 0;
        const up = hasRowAbove ? data[i - above]! : 0;
        const upLeft = hasLeft && hasRowAbove ? data[i - above - bytesPerPixel]! : 0;
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        const predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
        data[i] = data[i]! + predicted;
      }
      break;
    default:
      refuse(`it has a row with the invalid filter type ${filter}`);
  }
}

function copyDroppingOpaqueAlpha(row: Uint8Array, pixels: Uint8Array, y: number, width: number): void {
  let target = y * width * 3;
  for (let x = 0; x < width; x++) {
    const source = x * 4;
    const alpha = row[source + 3]!;
    if (alpha !== 255) {
      refuse(
        `pixel (${x}, ${y}) has alpha ${alpha}. Selfie handles only fully opaque images, ` +
          "and never flattens transparency",
      );
    }
    pixels[target++] = row[source]!;
    pixels[target++] = row[source + 1]!;
    pixels[target++] = row[source + 2]!;
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
