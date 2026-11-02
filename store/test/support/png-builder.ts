// Builds PNG files byte by byte, for testing the decoder. It shares no code with it,
// and takes a different route where it can: Adam7 comes from the PNG spec's 8×8 table
// rather than from pass offsets, and zlib is written by hand as stored blocks. Nothing
// here imports a platform API, so the same tests run in Node and in workerd.

export const GRAY = 0;
export const RGB = 2;
export const PALETTE = 3;
export const GRAY_ALPHA = 4;
export const RGBA = 6;

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const ADAM7_TABLE = [
  [1, 6, 4, 6, 2, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [3, 6, 4, 6, 3, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
];

export const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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
  for (const byte of bytes) {
    crc ^= byte;
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

/** A complete zlib stream of stored blocks, so a test controls its every byte. */
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
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export const iend = (): Uint8Array => chunk("IEND");

/** The image data of a 1×1 RGB image with these three samples. */
export const idat = (...rgb: readonly number[]): Uint8Array =>
  chunkOf("IDAT", zlibStored(new Uint8Array([0, ...rgb])));

export const pngFile = (...chunks: readonly Uint8Array[]): Uint8Array =>
  concat(SIGNATURE, ...chunks);

export interface PngSpec {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly bitDepth: number;
  /** The raw samples of a pixel, in the file's own units: a palette index, or up to 65535. */
  readonly sample: (x: number, y: number) => readonly number[];
  readonly interlaced?: boolean;
  /** The filter type for each row, cycling through the row numbers. Defaults to none. */
  readonly filters?: readonly number[];
  /** Chunks between IHDR and the image data. */
  readonly before?: readonly Uint8Array[];
  /** Chunks after the image data. */
  readonly after?: readonly Uint8Array[];
  /** Splits the image data across this many IDAT chunks. */
  readonly idatCount?: number;
  readonly deflate?: (raw: Uint8Array) => Uint8Array;
}

/** A PNG holding exactly the samples the spec gives, encoded the way it says. */
export function buildPng(spec: PngSpec): Uint8Array {
  const { width, height, colorType, bitDepth, interlaced = false } = spec;
  const { filters = [0], before = [], after = [], idatCount = 1, deflate = zlibStored } = spec;
  const channels = CHANNELS[colorType]!;
  const bytesPerPixel = Math.max(1, (channels * bitDepth) >> 3);

  const scanlines: number[] = [];
  let rowNumber = 0;
  const writeRow = (row: Uint8Array, above: Uint8Array | null) => {
    const filter = filters[rowNumber++ % filters.length]!;
    scanlines.push(filter);
    row.forEach((byte, i) => {
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
      const up = above?.[i] ?? 0;
      const upLeft = i >= bytesPerPixel ? (above?.[i - bytesPerPixel] ?? 0) : 0;
      scanlines.push((byte - predict(filter, left, up, upLeft)) & 255);
    });
  };

  for (const pass of interlaced ? [1, 2, 3, 4, 5, 6, 7] : [0]) {
    let above: Uint8Array | null = null;
    for (let y = 0; y < height; y++) {
      const columns: number[] = [];
      for (let x = 0; x < width; x++) {
        if (pass === 0 || ADAM7_TABLE[y % 8]![x % 8] === pass) columns.push(x);
      }
      if (columns.length === 0) continue;
      const row = packRow(columns.flatMap((x) => [...spec.sample(x, y)]), bitDepth);
      writeRow(row, above);
      above = row;
    }
  }

  const deflated = deflate(new Uint8Array(scanlines));
  const pieces: Uint8Array[] = [];
  const size = Math.ceil(deflated.length / idatCount);
  for (let i = 0; i < idatCount; i++) {
    pieces.push(chunkOf("IDAT", deflated.subarray(i * size, (i + 1) * size)));
  }
  return pngFile(
    ihdr({ width, height, bitDepth, colorType, interlace: interlaced ? 1 : 0 }),
    ...before,
    ...pieces,
    ...after,
    iend(),
  );
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

function packRow(samples: readonly number[], bitDepth: number): Uint8Array {
  if (bitDepth === 16) {
    return new Uint8Array(samples.flatMap((sample) => [sample >> 8, sample & 255]));
  }
  const row = new Uint8Array(Math.ceil((samples.length * bitDepth) / 8));
  samples.forEach((sample, i) => {
    const bit = i * bitDepth;
    row[bit >> 3]! |= sample << (8 - bitDepth - (bit & 7));
  });
  return row;
}

/** The same file with these chunks removed, leaving every other byte alone. */
export function withoutChunks(png: Uint8Array, ...types: readonly string[]): Uint8Array {
  const kept: Uint8Array[] = [png.subarray(0, SIGNATURE.length)];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = SIGNATURE.length; offset < png.length; ) {
    const end = offset + 12 + view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (!types.includes(type)) kept.push(png.subarray(offset, end));
    offset = end;
  }
  return concat(...kept);
}
