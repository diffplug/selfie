import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "../src/core/index.ts";
import { describePngContract } from "./contract/png-contract.ts";
import { buildPng, RGB } from "./support/png-builder.ts";
import { readPngFixture } from "./support/png-fixtures.ts";

describePngContract("Node", (name) => new Uint8Array(readPngFixture(name)));

describe("decodePng in Node", () => {
  it("reads a Node Buffer", async () => {
    const png = Buffer.from(buildPng({ width: 1, height: 1, colorType: RGB, bitDepth: 8, sample: () => [1, 2, 3] }));
    expect((await decodePng(png)).pixels).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("gives every zlib compression level the same pixels", async () => {
    const spec = {
      width: 64,
      height: 64,
      colorType: RGB,
      bitDepth: 8,
      sample: (x: number, y: number) => [x * 4, y * 4, (x ^ y) * 4],
    };
    const expected = await decodePng(buildPng(spec));
    const sizes = new Set<number>();
    for (const level of [0, 1, 6, 9]) {
      const png = buildPng({ ...spec, deflate: (raw) => deflateSync(raw, { level }) });
      sizes.add(png.length);
      expect(await decodePng(png)).toEqual(expected);
    }
    expect(sizes.size).toBeGreaterThan(1);
  });
});
