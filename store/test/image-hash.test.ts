import { describe, expect, it } from "vitest";
import { encodePam, sha256, toHex, truncateHash } from "../src/core/index.ts";

const hashOf = async (width: number, height: number, pixels: Uint8Array) =>
  toHex(await sha256(encodePam({ width, height, pixels })));

describe("encodePam", () => {
  it("writes the one canonical header followed by the pixels", () => {
    const pam = encodePam({ width: 2, height: 1, pixels: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    const header = "P7\nWIDTH 2\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n";
    expect([...pam]).toEqual([...new TextEncoder().encode(header), 1, 2, 3, 4, 5, 6]);
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

  it.each([0, 2, 4, 6])("refuses %s bytes of pixels for a 1×1 image", (length) => {
    expect(() => encodePam({ width: 1, height: 1, pixels: new Uint8Array(length) })).toThrow(
      RangeError,
    );
  });
});

describe("image hash", () => {
  // From `shasum -a 256` over the literal file bytes. Pins the canonical form: if
  // this changes, every image hash in every store changes with it.
  it("matches a hash computed outside this code", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3]))).toBe(
      "ef9d806b3ac8115d59120d0e65b1c3d24912c36fccca9ef0f143443a2daf794a",
    );
  });

  it("differs for the same bytes at swapped dimensions", async () => {
    const pixels = new Uint8Array(100 * 200 * 3).fill(7);
    expect(await hashOf(100, 200, pixels)).not.toBe(await hashOf(200, 100, pixels));
  });

  it("differs when one pixel byte differs", async () => {
    expect(await hashOf(1, 1, new Uint8Array([1, 2, 3]))).not.toBe(
      await hashOf(1, 1, new Uint8Array([1, 2, 4])),
    );
  });

  it("depends on the pixel values, not on how the array holds them", async () => {
    const expected = await hashOf(1, 1, new Uint8Array([1, 2, 3]));
    const offsetView = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5);
    const nodeBuffer = Buffer.from([1, 2, 3]);
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
