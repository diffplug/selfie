/**
 * The one place that knows what format image files are in: the narrow PNG Chromium
 * writes, and lossless WebP in its simple form, which is how a store keeps them. The
 * image hash never sees any of this: it covers the canonical PAM of the decoded pixels.
 *
 * `checkImageFile` reads only headers and structure, so it runs anywhere and is all a
 * Worker does. Decoding goes to an `ImageCodec`, which is native, so it runs on the client.
 * See `docs/specs/store.rationale.md` → Image decoding.
 */

import type { RawImage } from "./pam.ts";

/** A file was refused: it is corrupt, or it isn't a form the store accepts. */
export class ImageDecodeError extends Error {
  override readonly name = "ImageDecodeError";
}

/** A decoded file's samples: RGB, or RGBA if that's what its header says it holds. */
interface DecodedFile {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** Decodes and encodes image files on one platform. An adapter, since it needs a native library. */
export interface ImageCodec {
  /** Given only a file `checkImageFile` accepted. Must throw for a body it can't read. */
  decode(file: Uint8Array): Promise<DecodedFile>;
  /** Must write the simple form `checkImageFile` accepts, and decode to exactly these pixels. */
  encodeWebp(image: RawImage): Promise<Uint8Array>;
}

/** What a file's header says it holds. */
interface ImageFileInfo {
  readonly format: "PNG" | "WebP";
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
}

/** The most a WebP can hold on either side. A larger image stays a PNG. */
export const WEBP_MAX_SIDE = 16383;

// A header of a few bytes decides how much is allocated, so it can't be unbounded.
const MAX_PIXELS = 100_000_000;

/**
 * Throws `ImageDecodeError` for a file that isn't a form the store accepts, from its headers
 * and structure alone. It can't see inside a compressed body, so it doesn't know the file
 * decodes, or that it's opaque: only `decodeImage` knows that.
 */
export function checkImageFile(file: Uint8Array): ImageFileInfo {
  if (hasPngSignature(file)) return checkPng(file);
  if (hasWebpSignature(file)) return checkWebp(file);
  throw new ImageDecodeError("Refusing this file: it isn't a PNG or a WebP, the formats the store accepts");
}

/**
 * Decodes an image file to its exact 8-bit RGB. Throws `ImageDecodeError` for anything
 * else, including any transparency a decoder can see.
 */
export async function decodeImage(file: Uint8Array, codec: ImageCodec): Promise<RawImage> {
  const { format, width, height, channels } = checkImageFile(file);
  let decoded: DecodedFile;
  try {
    decoded = await codec.decode(file);
  } catch (error) {
    throw new ImageDecodeError(`Refusing this ${format}: it didn't decode: ${(error as Error).message}`);
  }
  if (decoded.width !== width || decoded.height !== height || decoded.pixels.length !== width * height * channels) {
    throw new ImageDecodeError(
      `Refusing this ${format}: it decoded to ${decoded.width}x${decoded.height} in ${decoded.pixels.length} bytes, ` +
        `rather than the ${width}x${height} with ${channels} channels its header states`,
    );
  }
  return { width, height, pixels: channels === 3 ? decoded.pixels : droppingOpaqueAlpha(decoded) };
}

/**
 * The WebP to keep for a new file, or null if it should stay as it is: it isn't a PNG, or
 * it's too large for a WebP. Must only be given a file that has already decoded.
 */
export async function webpToKeep(file: Uint8Array, codec: ImageCodec): Promise<Uint8Array | null> {
  const { format, width, height } = checkImageFile(file);
  if (format !== "PNG" || Math.max(width, height) > WEBP_MAX_SIDE) return null;
  return codec.encodeWebp(await decodeImage(file, codec));
}

/**
 * The media type of the bytes `Store.getImage` returns, read from their first bytes.
 * That makes every blob record its own format, with nothing else to keep in step, so
 * a store can hold a second format if the stored one changes.
 */
export function imageMediaType(file: Uint8Array): string {
  if (hasPngSignature(file)) return "image/png";
  if (hasWebpSignature(file)) return "image/webp";
  throw new RangeError("These bytes are not in a format the store writes");
}

function fourCc(file: Uint8Array, offset: number): string {
  return String.fromCharCode(...file.subarray(offset, offset + 4));
}

function hasWebpSignature(file: Uint8Array): boolean {
  return fourCc(file, 0) === "RIFF" && fourCc(file, 8) === "WEBP";
}

const VP8L_HEADER_BYTES = 25;
const VP8L_SIGNATURE = 0x2f;

function refuseWebp(reason: string): never {
  throw new ImageDecodeError(`Refusing this WebP: ${reason}`);
}

function checkWebp(file: Uint8Array): ImageFileInfo {
  if (file.length < VP8L_HEADER_BYTES) refuseWebp("it is truncated");
  const chunk = fourCc(file, 12);
  if (chunk !== "VP8L") refuseWebp(`its ${chunk.trim()} chunk isn't the simple lossless form, the only one accepted`);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const chunkBytes = view.getUint32(16, true);
  if (view.getUint32(4, true) + 8 !== file.length || 20 + chunkBytes + (chunkBytes & 1) !== file.length) {
    refuseWebp("its length doesn't match its header, so it is truncated or has something after the image");
  }
  if (file[20] !== VP8L_SIGNATURE) refuseWebp("its VP8L signature is wrong");
  const bits = view.getUint32(21, true);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  // Only a hint in the format, so a file can clear it and still hold alpha (`docs/specs/store.md`).
  if ((bits >>> 28) & 1) refuseWebp("it has transparency");
  if (bits >>> 29 !== 0) refuseWebp("its VP8L version isn't 0");
  if (width * height > MAX_PIXELS) refuseWebp(`at ${width}x${height} it is over the limit of ${MAX_PIXELS} pixels`);
  return { format: "WebP", width, height, channels: 3 };
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
const CHUNK_OVERHEAD = 12;

function hasPngSignature(bytes: Uint8Array): boolean {
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * Allows only IHDR, then IDAT chunks, then IEND. Anything else could change what a decoder
 * makes of the pixels, as a color profile does, and a library wouldn't say so.
 */
function checkPng(png: Uint8Array): ImageFileInfo {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let header: ImageFileInfo | null = null;
  let hasData = false;
  let offset = SIGNATURE.length;
  for (;;) {
    if (offset + CHUNK_OVERHEAD > png.length) refuse("it ends before its IEND chunk");
    const length = view.getUint32(offset);
    const end = offset + CHUNK_OVERHEAD + length;
    if (end > png.length) refuse("it ends inside a chunk");
    const type = fourCc(png, offset + 4);
    const body = png.subarray(offset + 8, end - 4);
    offset = end;

    if (header === null && type === "IHDR") {
      header = readHeader(body);
    } else if (header !== null && type === "IDAT") {
      hasData = true;
    } else if (header !== null && type === "IEND") {
      if (body.length !== 0) refuse("its IEND chunk is not empty");
      if (offset !== png.length) refuse("it has bytes after its IEND chunk");
      if (!hasData) refuse("it has no IDAT chunk");
      return header;
    } else {
      refuse(`its ${type} chunk isn't allowed here: the store accepts only IHDR, IDAT, IEND, in that order`);
    }
  }
}

function readHeader(body: Uint8Array): ImageFileInfo {
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
  return { format: "PNG", width, height, channels: colorType === RGB ? 3 : 4 };
}

function droppingOpaqueAlpha({ width, height, pixels: rgba }: DecodedFile): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  let source = 0;
  let target = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, source += 4) {
      const alpha = rgba[source + 3]!;
      if (alpha !== 255) {
        refuse(
          `pixel (${x}, ${y}) has alpha ${alpha}. Selfie handles only fully opaque images, ` +
            "and never flattens transparency",
        );
      }
      pixels[target++] = rgba[source]!;
      pixels[target++] = rgba[source + 1]!;
      pixels[target++] = rgba[source + 2]!;
    }
  }
  return pixels;
}
