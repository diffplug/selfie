// Builds PNG files byte by byte: the store has no PNG encoder for tests to use. It shares no code with the decoder, and writes zlib by
// hand as stored blocks so a test controls every byte. Nothing here imports a platform
// API, so the same tests run in Node and in workerd.

import type { RawImage } from "../../src/core/index.ts";

export const RGB = 2;
export const RGBA = 6;

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function chunk(type: string, ...body: readonly number[]): Uint8Array {
  return chunkOf(type, new Uint8Array(body));
}

export function chunkOf(type: string, body: Uint8Array): Uint8Array {
  const typed = concat(new TextEncoder().encode(type), body);
  return concat(uint32(body.length), typed, uint32(crc32(typed)));
}

export interface HeaderFields {
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly compression?: number;
  readonly filterMethod?: number;
  readonly interlace?: number;
}

/** An IHDR chunk, by default for a 1×1 8-bit RGB image. */
export function ihdr({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = RGB,
  compression = 0,
  filterMethod = 0,
  interlace = 0,
}: HeaderFields = {}): Uint8Array {
  const body = new Uint8Array([bitDepth, colorType, compression, filterMethod, interlace]);
  return chunkOf("IHDR", concat(uint32(width), uint32(height), body));
}

/** A complete zlib stream of stored blocks. */
export function zlibStored(raw: Uint8Array, adler = adler32(raw)): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const BLOCK = 65535;
  let offset = 0;
  do {
    const size = Math.min(BLOCK, raw.length - offset);
    const final = offset + size === raw.length ? 1 : 0;
    parts.push(new Uint8Array([final, size & 255, size >> 8, ~size & 255, (~size >> 8) & 255]));
    parts.push(raw.subarray(offset, offset + size));
    offset += size;
  } while (offset < raw.length);
  parts.push(uint32(adler));
  return concat(...parts);
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export const iend = (): Uint8Array => chunk("IEND");

/** The image data of a 1×1 image with these samples. */
export const idat = (...samples: readonly number[]): Uint8Array =>
  chunkOf("IDAT", zlibStored(new Uint8Array([0, ...samples])));

export const pngFile = (...chunks: readonly Uint8Array[]): Uint8Array =>
  concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks);

export interface PngOptions {
  /** The filter type for each row, cycling through the row numbers. Defaults to none. */
  readonly filters?: readonly number[];
  /** Splits the image data across this many IDAT chunks. */
  readonly idatCount?: number;
  readonly deflate?: (raw: Uint8Array) => Uint8Array;
  /** Gives each pixel this alpha, writing RGBA rather than RGB. */
  readonly alpha?: (x: number, y: number) => number;
}

/** A PNG of exactly these pixels, encoded the way the options say. */
export function pngOf(image: RawImage, options: PngOptions = {}): Uint8Array {
  const { width, height, pixels } = image;
  const { filters = [0], idatCount = 1, deflate = zlibStored, alpha } = options;
  const channels = alpha === undefined ? 3 : 4;
  const rowBytes = width * channels;

  const rows = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * channels;
      rows.set(pixels.subarray((y * width + x) * 3, (y * width + x + 1) * 3), target);
      if (alpha !== undefined) rows[target + 3] = alpha(x, y);
    }
  }

  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length]!;
    const start = y * (rowBytes + 1);
    scanlines[start] = filter;
    for (let i = 0; i < rowBytes; i++) {
      const at = y * rowBytes + i;
      const left = i >= channels ? rows[at - channels]! : 0;
      const up = y > 0 ? rows[at - rowBytes]! : 0;
      const upLeft = y > 0 && i >= channels ? rows[at - rowBytes - channels]! : 0;
      scanlines[start + 1 + i] = rows[at]! - predict(filter, left, up, upLeft);
    }
  }

  const deflated = deflate(scanlines);
  const size = Math.ceil(deflated.length / idatCount);
  const data = Array.from({ length: idatCount }, (_, i) =>
    chunkOf("IDAT", deflated.subarray(i * size, (i + 1) * size)),
  );
  return pngFile(ihdr({ width, height, colorType: alpha === undefined ? RGB : RGBA }), ...data, iend());
}

function predict(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const distances = [left, up, upLeft].map((value) => Math.abs(estimate - value));
      return [left, up, upLeft][distances.indexOf(Math.min(...distances))]!;
    }
    default:
      return 0;
  }
}

/** The same file with these chunks removed, leaving every other byte alone. */
export function withoutChunks(png: Uint8Array, ...types: readonly string[]): Uint8Array {
  const kept: Uint8Array[] = [png.subarray(0, 8)];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset < png.length; ) {
    const end = offset + 12 + view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (!types.includes(type)) kept.push(png.subarray(offset, end));
    offset = end;
  }
  return concat(...kept);
}
