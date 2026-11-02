import { describe, expect, it } from "vitest";
import { encodePam, sha256, toHex, truncateHash } from "../src/core/index.ts";

const hashOf = async (width: number, height: number, pixels: Uint8Array) =>
  toHex(await sha256(encodePam({ width, height, pixels })));

describe("encodePam", () => {
  const pamOf = (header: string, body: readonly number[]) => [
    ...new TextEncoder().encode(header),
    ...body,
  ];
  const RGB_HEADER = "P7\nWIDTH 2\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n";
  const RGBA_HEADER = "P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";

  it("writes RGB when every alpha is 255", () => {
    const pixels = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([...encodePam({ width: 2, height: 1, pixels })]).toEqual(
      pamOf(RGB_HEADER, [1, 2, 3, 4, 5, 6]),
    );
  });

  it.each([
    ["the first pixel", [1, 2, 3, 254, 4, 5, 6, 255]],
    ["only the last pixel", [1, 2, 3, 255, 4, 5, 6, 254]],
    ["every pixel, fully transparent", [1, 2, 3, 0, 4, 5, 6, 0]],
  ])("writes RGBA, unchanged, when alpha isn't 255 in %s", (_, values) => {
    const pixels = new Uint8Array(values);
    expect([...encodePam({ width: 2, height: 1, pixels })]).toEqual(pamOf(RGBA_HEADER, values));
  });

  it("leaves the caller's pixels alone", () => {
    const pixels = new Uint8Array([1, 2, 3, 255]);
    encodePam({ width: 1, height: 1, pixels });
    expect([...pixels]).toEqual([1, 2, 3, 255]);
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [1.5, 2],
    [NaN, 1],
  ])("refuses dimensions %s × %s", (width, height) => {
    expect(() => encodePam({ width, height, pixels: new Uint8Array(0) })).toThrow(RangeError);
  });

  it.each([0, 3, 5, 8])("refuses %s bytes of pixels for a 1×1 image", (length) => {
    expect(() => encodePam({ width: 1, height: 1, pixels: new Uint8Array(length) })).toThrow(
      RangeError,
    );
  });
});

describe("image hash", () => {
  // From `shasum -a 256` over the literal file bytes. Pins the canonical form: if
  // this changes, every image hash in every store changes with it.
  it("matches a hash computed outside this code", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3, 4]))).toBe(
      "64119739112e822d5739371ece5cd7adcea0d7728aff2b58bdbfbcd9bd209442",
    );
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3, 255]))).toBe("ef9d806b3ac8115d59120d0e65b1c3d24912c36fccca9ef0f143443a2daf794a");
  });

  it("differs between an opaque image and the same colors nearly opaque", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3, 255]))).not.toBe(
      await hashOf(1, 1, new Uint8Array([1, 2, 3, 254])),
    );
  });

  it("keeps the colors under fully transparent pixels", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3, 0]))).not.toBe(
      await hashOf(1, 1, new Uint8Array([9, 9, 9, 0])),
    );
  });

  it("differs for opaque images of the same bytes at swapped dimensions", async () => {
    const pixels = new Uint8Array(2 * 3 * 4).fill(255);
    pixels[0] = 1;
    expect(await hashOf(2, 3, pixels)).not.toBe(await hashOf(3, 2, pixels));
  });

  it("differs for the same bytes at swapped dimensions", async () => {
    const pixels = new Uint8Array(100 * 200 * 4).fill(7);
    expect(await hashOf(100, 200, pixels)).not.toBe(await hashOf(200, 100, pixels));
  });

  it("differs when one pixel byte differs", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3, 4]))).not.toBe(
      await hashOf(1, 1, new Uint8Array([1, 2, 3, 5])),
    );
  });

  it("depends on the pixel values, not on how the array holds them", async () => {
    const expected = await hashOf(1, 1, new Uint8Array([1, 2, 3, 4]));
    const offsetView = new Uint8Array([9, 9, 1, 2, 3, 4, 9]).subarray(2, 6);
    const nodeBuffer = Buffer.from([1, 2, 3, 4]);
    expect(await hashOf(1, 1, offsetView)).toBe(expected);
    expect(await hashOf(1, 1, nodeBuffer)).toBe(expected);
  });
});

describe("truncateHash", () => {
  const digest = (...prefix: number[]) => {
    const bytes = new Uint8Array(32);
    bytes.set(prefix);
    return bytes;
  };

  it("spans the whole range", () => {
    expect(truncateHash(new Uint8Array(32).fill(255))).toBe(Number.MAX_SAFE_INTEGER);
    expect(truncateHash(new Uint8Array(32))).toBe(0);
  });

  it("takes the lowest bit from the top of the seventh byte", () => {
    expect(truncateHash(digest(0, 0, 0, 0, 0, 0, 0b0000_1000))).toBe(1);
    expect(truncateHash(digest(0, 0, 0, 0, 0, 0, 0b0000_0111))).toBe(0);
  });

  it("reads the first byte as the highest", () => {
    expect(truncateHash(digest(0x80))).toBe(2 ** 52);
  });

  it("ignores everything after the first 53 bits", () => {
    const bytes = new Uint8Array(32).fill(255);
    bytes[6] = 0b1111_1000;
    expect(truncateHash(bytes)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("agrees with BigInt arithmetic over the hex form", async () => {
    for (let i = 0; i < 200; i++) {
      const bytes = await sha256(new Uint8Array([i]));
      expect(BigInt(truncateHash(bytes))).toBe(BigInt(`0x${toHex(bytes)}`) >> 203n);
    }
  });
});
