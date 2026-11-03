import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ImageDecodeError, type RawImage } from "../src/core/index.ts";
import { describeImageCheckContract } from "./contract/image-check-contract.ts";
import { decodeImage } from "./support/decode.ts";
import { imageHashOf } from "./support/image-hash-of.ts";
import {
  chunk,
  chunkOf,
  concat,
  idat,
  iend,
  ihdr,
  pngFile,
  pngOf,
  withoutChunks,
  zlibStored,
} from "./support/png-builder.ts";
import { readPngFixture } from "./support/png-fixtures.ts";

describeImageCheckContract("Node");

const fixture = (name: string) => new Uint8Array(readPngFixture(name));

function picture(width: number, height: number): RawImage {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 3)) & 255;
  return { width, height, pixels };
}

const PICTURE = picture(9, 7);
const ALL_FILTERS = [0, 1, 2, 3, 4];
const OPAQUE = () => 255;

const scanlinesOf = (...bytes: readonly number[]) => zlibStored(new Uint8Array(bytes));
const withData = (...bytes: readonly number[]) => pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(...bytes)), iend());

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

/** Bodies the file checks can't see into, so only decoding finds them. */
const BODIES: readonly (readonly [string, Uint8Array])[] = [
  ["a bad IDAT checksum", flipped(pngFile(ihdr(), idat(1, 2, 3), iend()), 13)],
  ["a flipped byte in image data", flipped(pngFile(ihdr(), idat(1, 2, 3), iend()), 17)],
  ["an invalid filter type", withData(5, 1, 2, 3)],
  ["too few image bytes", withData(0, 1, 2)],
  ["no image bytes", withData()],
  ["an empty IDAT", pngFile(ihdr(), chunk("IDAT"), iend())],
  ["image data that isn't zlib", pngFile(ihdr(), chunk("IDAT", 1, 2, 3, 4, 5, 6), iend())],
  ["a zlib stream cut short", pngFile(ihdr(), chunkOf("IDAT", scanlinesOf(0, 1, 2, 3).subarray(0, 9)), iend())],
  ["a zlib stream with a wrong checksum", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array([0, 1, 2, 3]), 12345)), iend())],
];

/** Fixtures, with sizes and image hashes as sharp 0.35.5 decoded them when a decoder of our own was checked against it. */
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

describe("decodeImage on a PNG", () => {
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

  describe("refusals", () => {
    it("accepts the base file the refusal cases are built on", async () => {
      expect(await decodeImage(pngFile(ihdr(), idat(1, 2, 3), iend()))).toEqual({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3]) });
    });

    it.each([0, 128, 254])("refuses RGBA alpha %i, naming the pixel", async (value) => {
      const png = pngOf(PICTURE, { alpha: (x, y) => (x === 8 && y === 6 ? value : 255) });
      await expectRefusal(png, new RegExp(`pixel \\(8, 6\\) has alpha ${value}\\. Selfie handles only fully opaque`));
    });

    it.each(BODIES)("refuses %s", async (_, file) => {
      await expectRefusal(file, /didn't decode/);
    });

    it.each([
      ["one image byte too many", withData(0, 1, 2, 3, 4)],
      ["a megabyte of image data for one pixel", pngFile(ihdr(), chunkOf("IDAT", zlibStored(new Uint8Array(1 << 20))), iend())],
      ["bytes after the zlib stream", pngFile(ihdr(), chunkOf("IDAT", concat(scanlinesOf(0, 1, 2, 3), new Uint8Array([7]))), iend())],
    ])("takes the pixels from %s, ignoring what's past the last row", async (_, file) => {
      expect((await decodeImage(file)).pixels).toHaveLength(3);
    });
  });

  it("reads a Node Buffer", async () => {
    const pixels = new Uint8Array([1, 2, 3]);
    const png = Buffer.from(pngOf({ width: 1, height: 1, pixels }));
    expect((await decodeImage(png)).pixels).toEqual(pixels);
  });

  it("gives every zlib compression level the same pixels", async () => {
    const pixels = new Uint8Array(64 * 64 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i >> 4) & 255;
    const image = { width: 64, height: 64, pixels };
    const sizes = new Set<number>();
    for (const level of [0, 1, 6, 9]) {
      const png = pngOf(image, { deflate: (raw) => deflateSync(raw, { level }) });
      sizes.add(png.length);
      expect(await decodeImage(png)).toEqual(image);
    }
    expect(sizes.size).toBeGreaterThan(1);
  });
});
