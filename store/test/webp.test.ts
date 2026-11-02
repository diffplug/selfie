import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sharpWebp } from "../src/adapters/sharp-webp.ts";
import {
  decodeImage,
  ImageDecodeError,
  imageMediaType,
  Store,
  WEBP_MAX_SIDE,
  type RawImage,
  type WebpCodec,
} from "../src/core/index.ts";
import { imageHashOf } from "./support/image-hash-of.ts";
import { pngOf } from "./support/png-builder.ts";
import { createTempStore } from "./support/temp-store.ts";

function pattern(width: number, height: number): RawImage {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) & 255;
  return { width, height, pixels };
}

const IMAGE = pattern(16, 12);

describe("decodeImage on a WebP", () => {
  it("decodes to exactly the pixels encoded, and the hash doesn't depend on the format", async () => {
    const webp = await sharpWebp.encode(IMAGE);
    const decoded = await decodeImage(webp, sharpWebp);
    expect({ ...decoded, pixels: [...decoded.pixels] }).toEqual({ ...IMAGE, pixels: [...IMAGE.pixels] });
    expect(await imageHashOf(decoded)).toBe(await imageHashOf(await decodeImage(pngOf(IMAGE))));
    expect(imageMediaType(webp)).toBe("image/webp");
  });

  describe("refuses", () => {
    const refused = async (file: Uint8Array, codec: WebpCodec | undefined = sharpWebp) => {
      const decoding = decodeImage(file, codec);
      await expect(decoding).rejects.toBeInstanceOf(ImageDecodeError);
      return decoding.catch((error: Error) => error.message);
    };
    const raw = (image: RawImage, channels: 3 | 4, pixels: Uint8Array = image.pixels) =>
      sharp(pixels, { raw: { width: image.width, height: image.height, channels } });

    it("a lossy one", async () => {
      expect(await refused(await raw(IMAGE, 3).webp({ quality: 80 }).toBuffer())).toContain("VP8 chunk");
    });

    it("one with transparency", async () => {
      const rgba = new Uint8Array(IMAGE.width * IMAGE.height * 4).fill(128);
      expect(await refused(await raw(IMAGE, 4, rgba).webp({ lossless: true }).toBuffer())).toMatch(/transparency|VP8X/);
    });

    it("one with metadata, which takes the extended form", async () => {
      const file = await raw(IMAGE, 3).webp({ lossless: true }).withExif({ IFD0: { Copyright: "x" } }).toBuffer();
      expect(await refused(file)).toContain("VP8X");
    });

    it("a truncated one, and one with something after the image", async () => {
      const file = await sharpWebp.encode(IMAGE);
      expect(await refused(file.subarray(0, file.length - 1))).toContain("length");
      expect(await refused(file.subarray(0, 20))).toContain("truncated");
      expect(await refused(new Uint8Array([...file, 0, 0]))).toContain("length");
    });

    it("a corrupt body, by way of the codec", async () => {
      const file = Uint8Array.from(await sharpWebp.encode(pattern(64, 64)));
      file.fill(0xff, 30);
      expect(await refused(file)).toContain("didn't decode");
    });

    it("a header stating more pixels than the limit, before asking the codec", async () => {
      const file = Uint8Array.from(await sharpWebp.encode(IMAGE));
      new DataView(file.buffer).setUint32(21, 16382 | (16382 << 14), true);
      const untouched: WebpCodec = {
        encode: () => Promise.reject(new Error("unused")),
        decode: () => Promise.reject(new Error("The codec was asked")),
      };
      expect(await refused(file, untouched)).toContain("over the limit");
    });

    it("a codec's answer that disagrees with the header", async () => {
      const file = await sharpWebp.encode(IMAGE);
      const wrong: WebpCodec = { ...sharpWebp, decode: () => Promise.resolve(pattern(2, 2)) };
      expect(await refused(file, wrong)).toContain("rather than");
    });

    it("any WebP, with no codec to read it", async () => {
      await expect(decodeImage(await sharpWebp.encode(IMAGE))).rejects.toThrow("nothing here can decode");
    });
  });
});

describe("a store with a WebP codec", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let encodes: number;
  let store: Store;
  const counting: WebpCodec = {
    ...sharpWebp,
    encode: (image) => {
      encodes += 1;
      return sharpWebp.encode(image);
    },
  };

  beforeEach(async () => {
    temp = await createTempStore();
    encodes = 0;
    store = new Store({ sql: temp.sql, blob: temp.blob, webp: counting });
  });
  afterEach(() => temp.destroy());

  it("keeps a new PNG as a WebP of the same pixels, under the same hash", async () => {
    const { hash } = await store.putImage(pngOf(IMAGE));
    const stored = (await store.getImage(hash))!;
    expect(imageMediaType(stored)).toBe("image/webp");
    expect(await imageHashOf(await decodeImage(stored, sharpWebp))).toBe(hash);
    expect(await imageHashOf(IMAGE)).toBe(hash);
    expect([...(await store.getPixels(hash))!.pixels]).toEqual([...IMAGE.pixels]);
  });

  it("doesn't encode an image it already has", async () => {
    await store.putImages([pngOf(IMAGE), pngOf(IMAGE)]);
    await store.putImage(pngOf(IMAGE));
    expect(encodes).toBe(1);
  });

  it("finds an image stored as a WebP when given its PNG, and the reverse", async () => {
    const { hash } = await store.putImage(pngOf(IMAGE));
    expect((await store.putImage(await sharpWebp.encode(IMAGE))).hash).toBe(hash);
    expect((await store.putImage(pngOf(IMAGE))).hash).toBe(hash);
  });

  it("keeps a WebP it's given as those exact bytes", async () => {
    const file = await sharpWebp.encode(pattern(8, 8));
    const { hash } = await store.putImage(file);
    expect(Buffer.compare((await store.getImage(hash))!, file)).toBe(0);
    expect(encodes).toBe(0);
  });

  it.each([
    [WEBP_MAX_SIDE, 1, "image/webp"],
    [1, WEBP_MAX_SIDE, "image/webp"],
    [WEBP_MAX_SIDE + 1, 1, "image/png"],
    [1, WEBP_MAX_SIDE + 1, "image/png"],
  ])("at %i by %i keeps it as %s", async (width, height, media) => {
    const { hash } = await store.putImage(pngOf(pattern(width, height)));
    expect(imageMediaType((await store.getImage(hash))!)).toBe(media);
  });

  it("stores nothing if the encoder changes the pixels", async () => {
    const lossy = new Store({
      sql: temp.sql,
      blob: temp.blob,
      webp: { ...sharpWebp, encode: (image) => sharpWebp.encode({ ...image, pixels: image.pixels.map((value) => value ^ 1) }) },
    });
    await expect(lossy.putImage(pngOf(IMAGE))).rejects.toThrow("changed an image's pixels");
    expect(await store.lookupKey(await imageHashOf(IMAGE))).toBeNull();
  });
});

describe("a store with no WebP codec", () => {
  it("keeps a PNG as it arrives and refuses a WebP", async () => {
    const temp = await createTempStore();
    try {
      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const png = pngOf(IMAGE);
      const { hash } = await store.putImage(png);
      expect(Buffer.compare((await store.getImage(hash))!, png)).toBe(0);
      await expect(store.putImage(await sharpWebp.encode(pattern(4, 4)))).rejects.toBeInstanceOf(ImageDecodeError);
    } finally {
      await temp.destroy();
    }
  });
});
