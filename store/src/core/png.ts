/**
 * The one place that knows images are stored as PNG, which is a lossless stand-in.
 * The image hash never sees any of this: it covers the canonical PAM of the pixels.
 *
 * Written here rather than taken from a library because a decoder must refuse what
 * it can't decode exactly, and that takes control of each chunk and of the inflate.
 * See `docs/specs/store.rationale.md` → Image decoding.
 */

import { assertRawImage, type RawImage } from "./pam.ts";

/**
 * The media type of the bytes `Store.getImage` returns, read from their first bytes.
 * That makes every blob record its own format, with nothing else to keep in step, so
 * a store can hold a second format if the stored one changes.
 */
export function imageMediaType(stored: Uint8Array): string {
  if (hasPngSignature(stored)) return "image/png";
  throw new RangeError("These bytes are not in a format the store writes");
}

/** A file was refused: it is corrupt, or it can't be exactly 8-bit opaque RGB. */
export class ImageDecodeError extends Error {
  override readonly name = "ImageDecodeError";
}

function refuse(reason: string): never {
  throw new ImageDecodeError(`Refusing this PNG: ${reason}`);
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const GRAY = 0;
const RGB = 2;
const PALETTE = 3;
const GRAY_ALPHA = 4;
const RGBA = 6;
const FORMATS: Readonly<Record<number, { channels: number; depths: readonly number[] }>> = {
  [GRAY]: { channels: 1, depths: [1, 2, 4, 8, 16] },
  [RGB]: { channels: 3, depths: [8, 16] },
  [PALETTE]: { channels: 1, depths: [1, 2, 4, 8] },
  [GRAY_ALPHA]: { channels: 2, depths: [8, 16] },
  [RGBA]: { channels: 4, depths: [8, 16] },
};

// A header of a few bytes decides how much is allocated, so it can't be unbounded.
const MAX_PIXELS = 100_000_000;
const CHUNK_OVERHEAD = 12;

// A browser applies these when it shows the file, so the same samples could look
// different depending on which encoding was stored first. `sRGB` only states what
// Selfie already assumes, and every other ancillary chunk leaves the colors alone.
const COLOR_CHUNKS = new Set(["gAMA", "cHRM", "iCCP", "cICP"]);
const ANIMATION_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);

interface Header {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
}

interface Chunks {
  readonly header: Header;
  /** RGB triples, for a paletted image. */
  readonly palette: Uint8Array | null;
  readonly transparency: Uint8Array | null;
  readonly data: readonly Uint8Array[];
}

/**
 * Decodes a PNG to its exact 8-bit RGB. An opaque alpha channel is dropped, and
 * grayscale, palette, interlaced and exact 16-bit files are normalized, so every
 * encoding of the same pixels gives the same result. Throws `ImageDecodeError` for
 * anything else, including any transparency.
 */
export async function decodePng(png: Uint8Array): Promise<RawImage> {
  const chunks = readChunks(png);
  const { width, height } = chunks.header;
  const scanlines = await inflate(chunks.data, scanlineBytes(chunks.header));
  return { width, height, pixels: scanlinesToRgb(scanlines, chunks) };
}

/** Encodes pixels as an 8-bit RGB PNG that `decodePng` returns exactly. */
export async function encodePng(image: RawImage): Promise<Uint8Array<ArrayBuffer>> {
  assertRawImage(image);
  const { width, height, pixels } = image;
  if (width * height > MAX_PIXELS) {
    throw new RangeError(`A ${width}x${height} image is over the limit of ${MAX_PIXELS} pixels`);
  }
  // Filter type 0 on every row: of the options measured on screenshots, it gave
  // smaller files than adaptive filtering, at far less CPU. Each row stays zeroed
  // in its first byte, which is that filter type.
  const rowBytes = width * 3;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    scanlines.set(row, y * (rowBytes + 1) + 1);
  }
  const deflate = new CompressionStream("deflate");
  const deflated = await new Response(new Blob([scanlines]).stream().pipeThrough(deflate)).bytes();

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = RGB;
  return concat([
    new Uint8Array(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflated),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

function readChunks(png: Uint8Array): Chunks {
  if (!hasPngSignature(png)) refuse("it has no PNG signature");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let previous = "";
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

    if (header === null) {
      if (type !== "IHDR") refuse("its first chunk is not IHDR");
      header = readHeader(body);
    } else if (type === "IEND") {
      if (body.length !== 0) refuse("its IEND chunk is not empty");
      if (offset !== png.length) refuse("it has bytes after its IEND chunk");
      break;
    } else if (type === "IDAT") {
      if (data.length > 0 && previous !== "IDAT") refuse("its IDAT chunks are not consecutive");
      data.push(body);
    } else if (type === "PLTE") {
      if (palette !== null || data.length > 0) refuse("its PLTE chunk is misplaced");
      if (header.colorType === GRAY || header.colorType === GRAY_ALPHA) {
        refuse("it is grayscale with a PLTE chunk");
      }
      if (body.length === 0 || body.length > 768 || body.length % 3 !== 0) {
        refuse(`its PLTE chunk has an invalid length of ${body.length}`);
      }
      palette = body;
    } else if (type === "tRNS") {
      if (transparency !== null || data.length > 0) refuse("its tRNS chunk is misplaced");
      assertTransparencyChunk(body, header.colorType, palette);
      transparency = body;
    } else if (type === "IHDR") {
      refuse("it has more than one IHDR chunk");
    } else if (COLOR_CHUNKS.has(type)) {
      refuse(`its ${type} chunk changes how its colors display, and Selfie compares raw samples`);
    } else if (ANIMATION_CHUNKS.has(type)) {
      refuse("it is animated, and an image is one picture");
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      // The PNG spec's rule: an uppercase first letter means a decoder that doesn't
      // know this chunk can't display the image correctly.
      refuse(`its ${type} chunk is critical and unknown`);
    }
    previous = type;
  }
  if (data.length === 0) refuse("it has no IDAT chunk");
  if (header.colorType === PALETTE && palette === null) refuse("it is paletted with no PLTE chunk");
  return { header, palette: header.colorType === PALETTE ? palette : null, transparency, data };
}

function readHeader(body: Uint8Array): Header {
  if (body.length !== 13) refuse(`its IHDR chunk is ${body.length} bytes, not 13`);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = body[8]!;
  const colorType = body[9]!;
  const compression = body[10]!;
  const filter = body[11]!;
  const interlace = body[12]!;
  if (width === 0 || height === 0) refuse(`it is ${width}x${height}`);
  if (width * height > MAX_PIXELS) {
    refuse(`at ${width}x${height} it is over the limit of ${MAX_PIXELS} pixels`);
  }
  if (!FORMATS[colorType]?.depths.includes(bitDepth)) {
    refuse(`bit depth ${bitDepth} with color type ${colorType} is not valid`);
  }
  if (compression !== 0) refuse(`its compression method ${compression} is not deflate`);
  if (filter !== 0) refuse(`its filter method ${filter} is not valid`);
  if (interlace > 1) refuse(`its interlace method ${interlace} is not valid`);
  return { width, height, bitDepth, colorType, interlaced: interlace === 1 };
}

function assertTransparencyChunk(
  body: Uint8Array,
  colorType: number,
  palette: Uint8Array | null,
): void {
  if (colorType === GRAY_ALPHA || colorType === RGBA) {
    refuse("it has both an alpha channel and a tRNS chunk");
  }
  if (colorType === PALETTE) {
    if (palette === null) refuse("its tRNS chunk comes before its PLTE chunk");
    if (body.length * 3 > palette.length) refuse("its tRNS chunk is longer than its palette");
  } else if (body.length !== (colorType === RGB ? 6 : 2)) {
    refuse(`its tRNS chunk has an invalid length of ${body.length}`);
  }
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

interface Pass {
  readonly x: number;
  readonly y: number;
  readonly stepX: number;
  readonly stepY: number;
}

const WHOLE_IMAGE: readonly Pass[] = [{ x: 0, y: 0, stepX: 1, stepY: 1 }];
const ADAM7: readonly Pass[] = [
  { x: 0, y: 0, stepX: 8, stepY: 8 },
  { x: 4, y: 0, stepX: 8, stepY: 8 },
  { x: 0, y: 4, stepX: 4, stepY: 8 },
  { x: 2, y: 0, stepX: 4, stepY: 4 },
  { x: 0, y: 2, stepX: 2, stepY: 4 },
  { x: 1, y: 0, stepX: 2, stepY: 2 },
  { x: 0, y: 1, stepX: 1, stepY: 2 },
];

/** The rows and columns of a pass. A small image has no pixels in some Adam7 passes. */
function passSize({ width, height }: Header, pass: Pass): { columns: number; rows: number } {
  const columns = Math.ceil((width - pass.x) / pass.stepX);
  const rows = Math.ceil((height - pass.y) / pass.stepY);
  return columns > 0 && rows > 0 ? { columns, rows } : { columns: 0, rows: 0 };
}

function rowBytesOf({ colorType, bitDepth }: Header, columns: number): number {
  return Math.ceil((columns * FORMATS[colorType]!.channels * bitDepth) / 8);
}

function passesOf(header: Header): readonly Pass[] {
  return header.interlaced ? ADAM7 : WHOLE_IMAGE;
}

function scanlineBytes(header: Header): number {
  let total = 0;
  for (const pass of passesOf(header)) {
    const { columns, rows } = passSize(header, pass);
    total += rows * (rowBytesOf(header, columns) + 1);
  }
  return total;
}

function scanlinesToRgb(scanlines: Uint8Array, chunks: Chunks): Uint8Array {
  const { header, palette, transparency } = chunks;
  const { width, height, bitDepth, colorType, interlaced } = header;
  const { channels } = FORMATS[colorType]!;
  const bytesPerPixel = Math.max(1, (channels * bitDepth) >> 3);
  const pixels = new Uint8Array(width * height * 3);
  // The format screenshots arrive in, so it takes a bulk copy.
  const isAlreadyRgb = colorType === RGB && bitDepth === 8 && !interlaced && transparency === null;
  const writeRow = isAlreadyRgb ? null : createRowWriter(pixels, header, palette, transparency);
  let offset = 0;
  for (const pass of passesOf(header)) {
    const { columns, rows } = passSize(header, pass);
    const rowBytes = rowBytesOf(header, columns);
    for (let row = 0; row < rows; row++) {
      const start = offset + 1;
      unfilterRow(scanlines, start, rowBytes, bytesPerPixel, row > 0);
      const unfiltered = scanlines.subarray(start, start + rowBytes);
      if (writeRow === null) {
        pixels.set(unfiltered, row * rowBytes);
      } else {
        writeRow(unfiltered, columns, pass, row);
      }
      offset = start + rowBytes;
    }
  }
  return pixels;
}

/** Reverses a row's filter in place. The row above it is unfiltered already. */
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
      for (let i = start + bytesPerPixel; i < end; i++) {
        data[i] = data[i]! + data[i - bytesPerPixel]!;
      }
      break;
    case 2:
      if (hasRowAbove) {
        for (let i = start; i < end; i++) {
          data[i] = data[i]! + data[i - above]!;
        }
      }
      break;
    case 3:
      for (let i = start; i < end; i++) {
        const left = i - start >= bytesPerPixel ? data[i - bytesPerPixel]! : 0;
        const up = hasRowAbove ? data[i - above]! : 0;
        data[i] = data[i]! + ((left + up) >> 1);
      }
      break;
    case 4:
      for (let i = start; i < end; i++) {
        const hasLeft = i - start >= bytesPerPixel;
        const left = hasLeft ? data[i - bytesPerPixel]! : 0;
        const up = hasRowAbove ? data[i - above]! : 0;
        const upLeft = hasLeft && hasRowAbove ? data[i - above - bytesPerPixel]! : 0;
        data[i] = data[i]! + paeth(left, up, upLeft);
      }
      break;
    default:
      refuse(`it has a row with the invalid filter type ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

type RowWriter = (row: Uint8Array, columns: number, pass: Pass, rowInPass: number) => void;

function createRowWriter(
  pixels: Uint8Array,
  header: Header,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): RowWriter {
  const { width, bitDepth, colorType } = header;
  const { channels } = FORMATS[colorType]!;
  // Below 8 bits the PNG spec scales grayscale to fill the range. This is a whole
  // number at depths 1, 2 and 4, so no rounding is involved.
  const grayScale = bitDepth < 8 ? 255 / (2 ** bitDepth - 1) : 1;
  const transparentRed = transparentSample(transparency, 0, bitDepth);
  const transparentGreen = transparentSample(transparency, 1, bitDepth);
  const transparentBlue = transparentSample(transparency, 2, bitDepth);
  const samples = new Uint8Array(width * channels);

  return (row, columns, pass, rowInPass) => {
    readSamples(row, columns * channels, bitDepth, samples);
    const y = pass.y + rowInPass * pass.stepY;
    for (let column = 0; column < columns; column++) {
      const x = pass.x + column * pass.stepX;
      const first = samples[column * channels]!;
      let red = first;
      let green = first;
      let blue = first;
      let alpha = 255;
      switch (colorType) {
        case GRAY:
          if (first === transparentRed) alpha = 0;
          red = green = blue = first * grayScale;
          break;
        case RGB:
          green = samples[column * 3 + 1]!;
          blue = samples[column * 3 + 2]!;
          if (first === transparentRed && green === transparentGreen && blue === transparentBlue) {
            alpha = 0;
          }
          break;
        case PALETTE:
          if (first * 3 >= palette!.length) {
            refuse(`pixel (${x}, ${y}) uses palette index ${first}, which is out of range`);
          }
          red = palette![first * 3]!;
          green = palette![first * 3 + 1]!;
          blue = palette![first * 3 + 2]!;
          alpha = transparency?.[first] ?? 255;
          break;
        case GRAY_ALPHA:
          alpha = samples[column * 2 + 1]!;
          break;
        case RGBA:
          green = samples[column * 4 + 1]!;
          blue = samples[column * 4 + 2]!;
          alpha = samples[column * 4 + 3]!;
          break;
      }
      if (alpha !== 255) {
        refuse(
          `pixel (${x}, ${y}) has alpha ${alpha}. Selfie handles only fully opaque images, ` +
            "and never flattens transparency",
        );
      }
      const target = (y * width + x) * 3;
      pixels[target] = red;
      pixels[target + 1] = green;
      pixels[target + 2] = blue;
    }
  };
}

/**
 * Unpacks a row to one byte per sample. Below 8 bits it holds the raw value. At 16
 * bits it holds the exact 8-bit value, which exists only when a sample is that value
 * × 257, per the PNG spec's scaling, so both of its bytes match.
 */
function readSamples(row: Uint8Array, count: number, bitDepth: number, samples: Uint8Array): void {
  if (bitDepth === 8) {
    samples.set(row.subarray(0, count));
  } else if (bitDepth === 16) {
    for (let i = 0; i < count; i++) {
      const high = row[i * 2]!;
      const low = row[i * 2 + 1]!;
      if (high !== low) {
        const sample = ((high << 8) | low).toString(16).padStart(4, "0");
        refuse(`its 16-bit sample 0x${sample} has no exact 8-bit value`);
      }
      samples[i] = high;
    }
  } else {
    const mask = 2 ** bitDepth - 1;
    for (let i = 0; i < count; i++) {
      const bit = i * bitDepth;
      samples[i] = (row[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & mask;
    }
  }
}

/**
 * The value `readSamples` gives the sample a grayscale or RGB tRNS chunk marks as
 * transparent, or -1 if no sample can match it. Only for those color types: a
 * paletted image's tRNS chunk has one alpha per palette entry instead.
 */
function transparentSample(transparency: Uint8Array | null, index: number, bitDepth: number): number {
  const high = transparency?.[index * 2];
  const low = transparency?.[index * 2 + 1];
  if (high === undefined || low === undefined) return -1;
  if (bitDepth === 16) return high === low ? low : -1;
  return low & (2 ** bitDepth - 1);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(CHUNK_OVERHEAD + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(body, 8);
  view.setUint32(8 + body.length, crc32(bytes.subarray(4, 8 + body.length)));
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
