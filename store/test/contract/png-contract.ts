import { describe, expect, it } from "vitest";
import { decodeImage, encodePam, ImageDecodeError, imageMediaType, type RawImage } from "../../src/core/index.ts";
import { imageHashOf } from "../support/image-hash-of.ts";
import {
  chunk,
  chunkOf,
  concat,
  idat,
  iend,
  ihdr,
  pngFile,
  pngOf,
  RGBA,
  withoutChunks,
  zlibStored,
  type HeaderFields,
} from "../support/png-builder.ts";

function picture(width: number, height: number): RawImage {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 3)) & 255;
  return { width, height, pixels };
}

const PICTURE = picture(9, 7);
const ALL_FILTERS = [0, 1, 2, 3, 4];
const OPAQUE = () => 255;

const headerOnly = (fields: HeaderFields) => pngFile(ihdr(fields), idat(1, 2, 3), iend());
const scanlinesOf = (...bytes: readonly number[]) => zlibStored(new Uint8Array(bytes));
const withData = (...bytes: readonly number[]) => pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(...bytes)), iend());
const withChunk = (type: string) => pngFile(ihdr(), chunk(type, 0, 0, 0, 1), idat(1, 2, 3), iend());
const VALID = pngFile(ihdr(), idat(1, 2, 3), iend());

/** The file with one byte flipped, this far from its end. */
function flipped(png: Uint8Array, fromEnd: number): Uint8Array {
  const bad = png.slice();
  bad[bad.length - fromEnd]! ^= 1;
  return bad;
}

async function expectRefusal(file: Uint8Array, pattern: RegExp): Promise<void> {
  const error = await decodeImage(file).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ImageDecodeError);
  expect((error as ImageDecodeError).message).toMatch(pattern);
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

const MALFORMED: readonly (readonly [string, Uint8Array, RegExp])[] = [
  ["an empty file", new Uint8Array(0), /isn't a PNG/],
  ["a file that is not a PNG", new TextEncoder().encode("GIF89a and more bytes"), /isn't a PNG/],
  ["only a signature", VALID.subarray(0, 8), /before its IEND/],
  ["no IEND chunk", pngFile(ihdr(), idat(1, 2, 3)), /before its IEND/],
  ["a file cut off inside a chunk", VALID.subarray(0, VALID.length - 14), /inside a chunk/],
  ["a chunk whose length runs past the file", pngFile(concat(new Uint8Array([0, 0, 0, 200]), chunk("IDAT"))), /inside a chunk/],
  ["bytes after IEND", concat(VALID, new Uint8Array([0])), /after its IEND/],
  ["a non-empty IEND", pngFile(ihdr(), idat(1, 2, 3), chunk("IEND", 0)), /IEND chunk is not empty/],
  ["a bad IHDR checksum", flipped(pngFile(ihdr()), 1), /IHDR chunk fails its checksum/],
  ["a bad IDAT checksum", flipped(pngFile(ihdr(), idat(1, 2, 3)), 1), /IDAT chunk fails its checksum/],
  ["a flipped byte in image data", flipped(pngFile(ihdr(), idat(1, 2, 3)), 5), /IDAT chunk fails its checksum/],
  ["a bad checksum on a refused chunk", flipped(pngFile(ihdr(), chunk("tEXt", 65, 0, 66)), 1), /tEXt chunk fails its checksum/],
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
  ["an invalid filter type", withData(5, 1, 2, 3), /invalid filter type 5/],
  ["too few image bytes", withData(0, 1, 2), /inflates to 3 bytes, not 4/],
  ["no image bytes", withData(), /inflates to 0 bytes, not 4/],
  ["one image byte too many", withData(0, 1, 2, 3, 4), /more than the expected 4/],
  ["a megabyte of image data for one pixel", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array(1 << 20))), iend()), /more than the expected 4/],
  ["an empty IDAT", pngFile(ihdr(), chunk("IDAT"), iend()), /image data is corrupt/],
  ["image data that isn't zlib", pngFile(ihdr(), chunk("IDAT", 1, 2, 3, 4, 5, 6), iend()), /image data is corrupt/],
  ["a zlib stream cut short", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(0, 1, 2, 3).subarray(0, 9)), iend()), /image data is corrupt/],
  ["a zlib stream with a wrong checksum", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array([0, 1, 2, 3]), 12345)), iend()), /image data is corrupt/],
  ["bytes after the zlib stream", pngFile(ihdr(), chunkOf("IDAT", concat(scanlinesOf(0, 1, 2, 3), new Uint8Array([7]))), iend()), /image data is corrupt/],
];

/** Fixtures, with sizes and image hashes as sharp 0.35.5 decodes them, not this decoder. */
const FIXTURES: readonly (readonly [string, number, number, string])[] = [
  ["chromium-header-icon.png", 1200, 900, "64510f4f00686b829f6a4ec51edfb126d08c407a8422e7d453e5d6b5bb37c0b5"],
  ["chromium-update-banner.png", 1200, 900, "24c5c371fd3c5bddca4d968b613dfd5e0c3efb6dca7b893e7c8bebb762d13559"],
  ["pngsuite/basn2c08.png", 32, 32, "6c5282e6d6159c3b654fecb9e22e6bca88ec41c0b0b752521566ee79d68049aa"],
  ["pngsuite/f00n2c08.png", 32, 32, "ca6f9679f384eae5399f99503dee8069ceba3006e72fcb72f21faf64e05e0fd5"],
  ["pngsuite/f01n2c08.png", 32, 32, "f0af937d9674bfd107b4dccbfc7a39519fb4fde2eec5159ccd72bba2b4540577"],
  ["pngsuite/f02n2c08.png", 32, 32, "064d4ae2a921c63f643fb4c007396cf95192f6b7effe5de8d92a82ea0ad1d9f2"],
  ["pngsuite/f03n2c08.png", 32, 32, "fc4b8c94a33c7d2162fad29308f978d3cad608f144e91ad9703d3f9b4bb146cf"],
  ["pngsuite/f04n2c08.png", 32, 32, "1edf4359dfff910f39b9b19bed7171c4a4132c23d72bab3d16f1170f89d66144"],
  ["pngsuite/z00n2c08.png", 32, 32, "2ffb3287b1288ad083a6260def3bcb039b6955d8eb2e2e948dfbaf96289c0f46"],
  ["pngsuite/z09n2c08.png", 32, 32, "2ffb3287b1288ad083a6260def3bcb039b6955d8eb2e2e948dfbaf96289c0f46"],
];

/** Fixture files by their path under `test/fixtures/png`, which each runtime loads its own way. */
export type PngFixtures = (name: string) => Uint8Array;

/** Run this in each runtime the store core must work in. */
export function describePngContract(runtime: string, fixture: PngFixtures): void {
  describe(`PNG contract: ${runtime}`, () => {
    describe("filters and IDAT splits", () => {
      it.each(ALL_FILTERS)("decodes filter %i on every row", async (filter) => {
        expect(await decodeImage(pngOf(PICTURE, { filters: [filter] }))).toEqual(PICTURE);
        const opaque = pngOf(PICTURE, { filters: [filter], alpha: OPAQUE });
        expect(await decodeImage(opaque)).toEqual(PICTURE);
      });

      it("decodes each filter in turn", async () => {
        expect(await decodeImage(pngOf(PICTURE, { filters: ALL_FILTERS }))).toEqual(PICTURE);
      });

      it.each([2, 3, 50])("decodes image data split across %i IDAT chunks", async (idatCount) => {
        expect(await decodeImage(pngOf(PICTURE, { idatCount }))).toEqual(PICTURE);
      });

      it("gives every encoding of a picture one hash", async () => {
        const hashes = new Set<string>();
        for (const options of [{}, { filters: ALL_FILTERS }, { idatCount: 3 }, { alpha: OPAQUE }]) {
          hashes.add(await imageHashOf(await decodeImage(pngOf(PICTURE, options))));
        }
        expect([...hashes]).toEqual([await imageHashOf(PICTURE)]);
      });

      it("gives a different hash when one pixel differs", async () => {
        const pixels = PICTURE.pixels.slice();
        pixels[pixels.length - 1]! ^= 1;
        const changed = await decodeImage(pngOf({ ...PICTURE, pixels }));
        expect(await imageHashOf(changed)).not.toBe(await imageHashOf(PICTURE));
      });

      it("reads a file from any view of its bytes", async () => {
        const png = pngOf(PICTURE);
        const padded = new Uint8Array(png.length + 10);
        padded.set(png, 5);
        expect(await decodeImage(padded.subarray(5, 5 + png.length))).toEqual(PICTURE);
      });
    });

    describe("fixtures", () => {
      // basn2c08 states a gamma, which is refused, so its samples are tested without it.
      it.each(FIXTURES)("decodes %s to the pixels sharp found", async (name, width, height, hash) => {
        const image = await decodeImage(withoutChunks(fixture(name), "gAMA"));
        expect({ width: image.width, height: image.height }).toEqual({ width, height });
        expect(await imageHashOf(image)).toBe(hash);
      });

      it("refuses a suite file for its gamma as distributed", async () => {
        await expectRefusal(fixture("pngsuite/basn2c08.png"), /gAMA chunk isn't allowed/);
      });

      it("refuses a suite file's real alpha", async () => {
        await expectRefusal(withoutChunks(fixture("pngsuite/basn6a08.png"), "gAMA"), /pixel \(0, 0\) has alpha 0/);
      });

      it("gives a screenshot re-encoded with other filters and splits the same hash", async () => {
        const image = await decodeImage(fixture("chromium-update-banner.png"));
        const reencoded = pngOf(image, { filters: ALL_FILTERS, idatCount: 4 });
        expect(reencoded).not.toEqual(fixture("chromium-update-banner.png"));
        expect(await imageHashOf(await decodeImage(reencoded))).toBe(await imageHashOf(image));
      });
    });

    describe("round trips", () => {
      const noise = (length: number) => {
        // A fixed sequence, so a failure repeats.
        const pixels = new Uint8Array(length);
        let state = 12345;
        for (let i = 0; i < length; i++) {
          state = (state * 1103515245 + 12345) & 0x7fffffff;
          pixels[i] = state >>> 16;
        }
        return pixels;
      };

      it.each([
        [1, 1],
        [1, 40],
        [40, 1],
        [2, 2],
        [17, 13],
        [300, 200],
      ])("returns the exact pixels of noise at %i×%i", async (width, height) => {
        const image = { width, height, pixels: noise(width * height * 3) };
        expect(await decodeImage(pngOf(image, { filters: ALL_FILTERS }))).toEqual(image);
      });

      it("returns every byte value exactly", async () => {
        const image = { width: 256, height: 1, pixels: Uint8Array.from({ length: 768 }, (_, i) => i % 256) };
        expect(await decodeImage(pngOf(image))).toEqual(image);
      });

      it("returns a real screenshot's exact pixels", async () => {
        const image = await decodeImage(fixture("chromium-header-icon.png"));
        expect(await imageHashOf(await decodeImage(pngOf(image)))).toBe(await imageHashOf(image));
      });
    });

    describe("media type", () => {
      it("reads a stored file's format from its bytes", () => {
        expect(imageMediaType(VALID)).toBe("image/png");
      });

      it.each([
        ["nothing", new Uint8Array(0)],
        ["a PAM file", encodePam(PICTURE)],
      ])("refuses %s", (_, bytes) => {
        expect(() => imageMediaType(bytes)).toThrow(RangeError);
      });
    });

    describe("refusals", () => {
      it("accepts the base file the refusal cases are built on", async () => {
        expect(await decodeImage(VALID)).toEqual({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3]) });
      });

      it.each(REFUSED_FORMATS_AND_CHUNKS)("refuses %s", async (_, file, pattern) => {
        await expectRefusal(file, pattern);
      });

      it.each([0, 128, 254])("refuses RGBA alpha %i, naming the pixel", async (value) => {
        const png = pngOf(PICTURE, { alpha: (x, y) => (x === 8 && y === 6 ? value : 255) });
        await expectRefusal(png, new RegExp(`pixel \\(8, 6\\) has alpha ${value}\\. Selfie handles only fully opaque`));
      });

      it.each(MALFORMED)("refuses %s", async (_, file, pattern) => {
        await expectRefusal(file, pattern);
      });
    });
  });
}
