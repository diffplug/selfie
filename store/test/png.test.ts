import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeImage } from "../src/core/index.ts";
import { describePngContract } from "./contract/png-contract.ts";
import { pngOf } from "./support/png-builder.ts";
import { readPngFixture } from "./support/png-fixtures.ts";

describePngContract("Node", (name) => new Uint8Array(readPngFixture(name)));

describe("decodeImage in Node", () => {
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
