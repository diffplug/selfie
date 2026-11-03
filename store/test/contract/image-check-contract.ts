import { describe, expect, it } from "vitest";
import { checkImageFile, encodePam, ImageDecodeError, imageMediaType } from "../../src/core/index.ts";
import {
  chunk,
  chunkOf,
  concat,
  idat,
  iend,
  ihdr,
  pngFile,
  RGBA,
  zlibStored,
  type HeaderFields,
} from "../support/png-builder.ts";

const headerOnly = (fields: HeaderFields) => pngFile(ihdr(fields), idat(1, 2, 3), iend());
const withChunk = (type: string) => pngFile(ihdr(), chunk(type, 0, 0, 0, 1), idat(1, 2, 3), iend());
const VALID = pngFile(ihdr(), idat(1, 2, 3), iend());

// A real 1x1 lossless WebP, as `sharp` writes one, so this runs where `sharp` can't.
const WEBP = Uint8Array.from(atob("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQiirUo/+BiOh/AAA="), (char) => char.charCodeAt(0));

/** The WebP with its 32 bits after the VP8L signature changed. */
function withWebpBits(change: (bits: number) => number): Uint8Array {
  const file = WEBP.slice();
  const view = new DataView(file.buffer);
  view.setUint32(21, change(view.getUint32(21, true)) >>> 0, true);
  return file;
}

const REFUSED_FORMATS_AND_CHUNKS: readonly (readonly [string, Uint8Array, RegExp])[] = [
  ["8-bit grayscale", headerOnly({ colorType: 0 }), /8-bit grayscale/],
  ["1-bit grayscale", headerOnly({ colorType: 0, bitDepth: 1 }), /1-bit grayscale/],
  ["16-bit grayscale", headerOnly({ colorType: 0, bitDepth: 16 }), /16-bit grayscale/],
  ["8-bit palette", headerOnly({ colorType: 3 }), /8-bit palette/],
  ["4-bit palette", headerOnly({ colorType: 3, bitDepth: 4 }), /4-bit palette/],
  ["grayscale with alpha", headerOnly({ colorType: 4 }), /8-bit grayscale with alpha/],
  ["16-bit RGB", headerOnly({ bitDepth: 16 }), /16-bit RGB/],
  ["16-bit RGBA", headerOnly({ colorType: RGBA, bitDepth: 16 }), /16-bit RGBA/],
  ["an invalid bit depth", headerOnly({ bitDepth: 3 }), /3-bit RGB/],
  ["an unknown color type", headerOnly({ colorType: 1 }), /color type 1/],
  ["interlaced RGB", headerOnly({ interlace: 1 }), /interlaced/],
  ["interlaced RGBA", headerOnly({ colorType: RGBA, interlace: 1 }), /interlaced/],
  ...["PLTE", "tRNS", "gAMA", "cHRM", "iCCP", "cICP", "sRGB", "acTL", "fcTL", "fdAT", "tEXt", "pHYs", "tIME", "CrIt", "prVt"].map(
    (type): [string, Uint8Array, RegExp] => [`a ${type} chunk`, withChunk(type), new RegExp(`its ${type} chunk isn't allowed`)],
  ),
  ["metadata after the image data", pngFile(ihdr(), idat(1, 2, 3), chunk("tEXt", 65, 0, 66), iend()), /tEXt chunk isn't allowed/],
];

const REFUSED_STRUCTURES: readonly (readonly [string, Uint8Array, RegExp])[] = [
  ["an empty file", new Uint8Array(0), /isn't a PNG/],
  ["a file that is not a PNG", new TextEncoder().encode("GIF89a and more bytes"), /isn't a PNG/],
  ["only a signature", VALID.subarray(0, 8), /before its IEND/],
  ["no IEND chunk", pngFile(ihdr(), idat(1, 2, 3)), /before its IEND/],
  ["a file cut off inside a chunk", VALID.subarray(0, VALID.length - 14), /inside a chunk/],
  ["a chunk whose length runs past the file", pngFile(concat(new Uint8Array([0, 0, 0, 200]), chunk("IDAT"))), /inside a chunk/],
  ["bytes after IEND", concat(VALID, new Uint8Array([0])), /after its IEND/],
  ["a non-empty IEND", pngFile(ihdr(), idat(1, 2, 3), chunk("IEND", 0)), /IEND chunk is not empty/],
  ["image data before IHDR", pngFile(idat(1, 2, 3), ihdr(), iend()), /IDAT chunk isn't allowed here/],
  ["IEND before IHDR", pngFile(iend()), /IEND chunk isn't allowed here/],
  ["an IHDR chunk that is too short", pngFile(chunk("IHDR", 0, 0, 0, 1), idat(1, 2, 3), iend()), /IHDR chunk is 4 bytes/],
  ["two IHDR chunks", pngFile(ihdr(), ihdr(), idat(1, 2, 3), iend()), /IHDR chunk isn't allowed here/],
  ["zero width", headerOnly({ width: 0 }), /it is 0x1/],
  ["zero height", headerOnly({ height: 0 }), /it is 1x0/],
  ["more pixels than the limit", headerOnly({ width: 100_000_001 }), /over the limit/],
  ["dimensions that overflow", headerOnly({ width: 2 ** 31, height: 2 ** 31 }), /over the limit/],
  ["an unknown compression method", headerOnly({ compression: 1 }), /compression method 1/],
  ["an unknown filter method", headerOnly({ filterMethod: 1 }), /filter method 1/],
  ["no image data", pngFile(ihdr(), iend()), /no IDAT/],
];


const REFUSED_WEBPS: readonly (readonly [string, Uint8Array, RegExp])[] = [
  ["one cut short", WEBP.subarray(0, WEBP.length - 1), /length/],
  ["only a header", WEBP.subarray(0, 20), /truncated/],
  ["bytes after the image", concat(WEBP, new Uint8Array(2)), /length/],
  ["a lossy chunk", new TextEncoder().encode("RIFF\x12\0\0\0WEBPVP8 \x06\0\0\0abcdefghijklm"), /VP8 chunk/],
  ["the extended form", new TextEncoder().encode("RIFF\x12\0\0\0WEBPVP8X\x0a\0\0\0abcdefghijklm"), /VP8X chunk/],
  ["its alpha bit", withWebpBits((bits) => bits | (1 << 28)), /transparency/],
  ["another version", withWebpBits((bits) => bits | (1 << 29)), /version/],
  ["more pixels than the limit", withWebpBits(() => 16382 | (16382 << 14)), /over the limit/],
];

function expectRefusal(file: Uint8Array, pattern: RegExp): void {
  let error: unknown;
  try {
    checkImageFile(file);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(ImageDecodeError);
  expect((error as ImageDecodeError).message).toMatch(pattern);
}

/** Run this in each runtime the store core must work in. */
export function describeImageCheckContract(runtime: string): void {
  describe(`Image file checks: ${runtime}`, () => {
    it("reads what a header states", () => {
      expect(checkImageFile(VALID)).toEqual({ format: "PNG", width: 1, height: 1, channels: 3 });
      expect(checkImageFile(pngFile(ihdr({ colorType: RGBA }), idat(1, 2, 3), iend()))).toMatchObject({ channels: 4 });
      expect(checkImageFile(WEBP)).toEqual({ format: "WebP", width: 1, height: 1, channels: 3 });
    });

    it("doesn't read a body, so it can't tell if a file decodes", () => {
      expect(() => checkImageFile(pngFile(ihdr(), chunk("IDAT", 1, 2, 3), iend()))).not.toThrow();
      const corrupt = WEBP.slice();
      corrupt.fill(0xff, 25);
      expect(() => checkImageFile(corrupt)).not.toThrow();
    });

    it("reads a file from any view of its bytes", () => {
      const padded = new Uint8Array(VALID.length + 10);
      padded.set(VALID, 5);
      expect(checkImageFile(padded.subarray(5, 5 + VALID.length))).toMatchObject({ format: "PNG" });
    });

    describe("media type", () => {
      it("reads a stored file's format from its bytes", () => {
        expect(imageMediaType(VALID)).toBe("image/png");
      });

      it.each([
        ["nothing", new Uint8Array(0)],
        ["a PAM file", encodePam({ width: 1, height: 1, pixels: new Uint8Array(3) })],
      ])("refuses %s", (_, bytes) => {
        expect(() => imageMediaType(bytes)).toThrow(RangeError);
      });
    });

    it.each(REFUSED_FORMATS_AND_CHUNKS)("refuses %s", (_, file, pattern) => expectRefusal(file, pattern));
    it.each(REFUSED_STRUCTURES)("refuses %s", (_, file, pattern) => expectRefusal(file, pattern));
    it.each(REFUSED_WEBPS)("refuses a WebP with %s", (_, file, pattern) => expectRefusal(file, pattern));
  });
}
