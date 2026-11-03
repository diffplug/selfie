import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sharpCodec } from "../src/adapters/sharp-codec.ts";
import {
  decodeImage as decodeWith,
  ImageDecodeError,
  ImageHashMismatchError,
  imageMediaType,
  ReceivingStore,
  Sql,
  Store,
  WEBP_MAX_SIDE,
  type ImageCodec,
  type RawImage,
} from "../src/core/index.ts";
import { decodeImage } from "./support/decode.ts";
import { imageHashOf } from "./support/image-hash-of.ts";
import { pngOf } from "./support/png-builder.ts";
import { createTempStore } from "./support/temp-store.ts";

function pattern(width: number, height: number): RawImage {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) & 255;
  return { width, height, pixels };
}

const IMAGE = pattern(16, 12);

/** A WebP whose header is fine and whose body isn't. */
const corruptWebp = async () => {
  const file = Uint8Array.from(await sharpCodec.encodeWebp(pattern(64, 64)));
  file.fill(0xff, 30);
  return file;
};

describe("decodeImage on a WebP", () => {
  it("decodes to exactly the pixels encoded, and the hash doesn't depend on the format", async () => {
    const webp = await sharpCodec.encodeWebp(IMAGE);
    const decoded = await decodeImage(webp);
    expect({ ...decoded, pixels: [...decoded.pixels] }).toEqual({ ...IMAGE, pixels: [...IMAGE.pixels] });
    expect(await imageHashOf(decoded)).toBe(await imageHashOf(await decodeImage(pngOf(IMAGE))));
    expect(imageMediaType(webp)).toBe("image/webp");
  });

  describe("refuses", () => {
    const refused = async (file: Uint8Array, codec: ImageCodec = sharpCodec) => {
      const decoding = decodeWith(file, codec);
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

    it("a corrupt body, by way of the codec", async () => {
      expect(await refused(await corruptWebp())).toContain("didn't decode");
    });

    it("a header stating more pixels than the limit, before asking the codec", async () => {
      const file = Uint8Array.from(await sharpCodec.encodeWebp(IMAGE));
      new DataView(file.buffer).setUint32(21, 16382 | (16382 << 14), true);
      const untouched: ImageCodec = {
        encodeWebp: () => Promise.reject(new Error("unused")),
        decode: () => Promise.reject(new Error("The codec was asked")),
      };
      expect(await refused(file, untouched)).toContain("over the limit");
    });

    it("a codec's answer that disagrees with the header", async () => {
      const file = await sharpCodec.encodeWebp(IMAGE);
      const wrong: ImageCodec = { ...sharpCodec, decode: () => Promise.resolve(pattern(2, 2)) };
      expect(await refused(file, wrong)).toContain("rather than");
    });

  });

  it("can't see transparency when a file's alpha bit is cleared, since that bit is only a hint", async () => {
    // Pinned, not wanted: `docs/specs/store.md` -> Image decoding says what this leaves open.
    const rgba = new Uint8Array(IMAGE.width * IMAGE.height * 4);
    for (let pixel = 0; pixel < IMAGE.width * IMAGE.height; pixel++) {
      rgba.set(IMAGE.pixels.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = pixel % 2 === 0 ? 255 : 128;
    }
    const raw = { width: IMAGE.width, height: IMAGE.height, channels: 4 } as const;
    const file = Uint8Array.from(await sharp(rgba, { raw }).webp({ lossless: true }).toBuffer());
    const view = new DataView(file.buffer);
    view.setUint32(21, (view.getUint32(21, true) & ~(1 << 28)) >>> 0, true);
    expect(await decodeImage(file)).toEqual({ ...IMAGE, pixels: IMAGE.pixels });
  });
});

describe("a store with a WebP codec", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let encodes: number;
  let store: Store;
  const counting: ImageCodec = {
    ...sharpCodec,
    encodeWebp: (image) => {
      encodes += 1;
      return sharpCodec.encodeWebp(image);
    },
  };

  beforeEach(async () => {
    temp = await createTempStore();
    encodes = 0;
    store = new Store({ sql: temp.sql, blob: temp.blob, codec: counting });
  });
  afterEach(() => temp.destroy());

  it("keeps a new PNG as a WebP of the same pixels, under the same hash", async () => {
    const { hash } = await store.putImage(pngOf(IMAGE));
    const stored = (await store.getImage(hash))!;
    expect(imageMediaType(stored)).toBe("image/webp");
    expect(await imageHashOf(await decodeImage(stored))).toBe(hash);
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
    expect((await store.putImage(await sharpCodec.encodeWebp(IMAGE))).hash).toBe(hash);
    expect((await store.putImage(pngOf(IMAGE))).hash).toBe(hash);
  });

  it("keeps a WebP it's given as those exact bytes", async () => {
    const file = await sharpCodec.encodeWebp(pattern(8, 8));
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
      codec: { ...sharpCodec, encodeWebp: (image) => sharpCodec.encodeWebp({ ...image, pixels: image.pixels.map((value) => value ^ 1) }) },
    });
    await expect(lossy.putImage(pngOf(IMAGE))).rejects.toThrow("changed an image's pixels");
    expect(await store.lookupKey(await imageHashOf(IMAGE))).toBeNull();
  });
});

describe("a store with no codec, as a Worker has", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let store: ReceivingStore;
  const hash = "c".repeat(64);

  beforeEach(async () => {
    temp = await createTempStore();
    store = new ReceivingStore({ sql: temp.sql, blob: temp.blob });
  });
  afterEach(() => temp.destroy());

  it("takes a WebP or a PNG under the hash it's sent with, as those exact bytes", async () => {
    const webp = await sharpCodec.encodeWebp(IMAGE);
    expect((await store.receiveImage(webp, hash)).hash).toBe(hash);
    expect(await store.getImage(hash)).toEqual(webp);
    const png = pngOf(IMAGE);
    const other = "d".repeat(64);
    await store.receiveImage(png, other);
    expect(await store.getImage(other)).toEqual(png);
  });

  it("is one image to a hash: it keeps the first bytes, and the same key", async () => {
    const webp = await sharpCodec.encodeWebp(IMAGE);
    const first = await store.receiveImage(webp, hash);
    expect(await store.receiveImage(pngOf(pattern(2, 2)), hash)).toEqual(first);
    expect(await store.getImage(hash)).toEqual(webp);
  });

  it("takes a key from the hash it's given, as one from pixels would", async () => {
    const real = await new Store({ sql: temp.sql, blob: temp.blob, codec: sharpCodec }).putImage(pngOf(IMAGE));
    const { key } = await store.receiveImage(pngOf(IMAGE), real.hash);
    expect(key).toBe(real.key);
    const otherTemp = await createTempStore();
    try {
      const fresh = new ReceivingStore({ sql: otherTemp.sql, blob: otherTemp.blob });
      expect((await fresh.receiveImage(pngOf(IMAGE), real.hash)).key).toBe(real.key);
    } finally {
      await otherTemp.destroy();
    }
  });

  it("refuses what no store keeps, and what isn't a hash, storing nothing", async () => {
    await expect(store.receiveImage(new Uint8Array([1, 2, 3]), hash)).rejects.toBeInstanceOf(ImageDecodeError);
    await expect(store.receiveImage(pngOf(IMAGE), "nope")).rejects.toThrow(RangeError);
    expect(await store.lookupKey(hash)).toBeNull();
  });

  it("stores a corrupt body, which only a client that decodes it can find", async () => {
    const corrupt = await corruptWebp();
    await store.receiveImage(corrupt, hash);
    expect(await store.getImage(hash)).toEqual(corrupt);
  });

  it("spends one SQL request an image, whether it's new or not", async () => {
    let requests = 0;
    const counting = new Sql({
      execute: (statements) => {
        requests += 1;
        return temp.connect().batch(statements);
      },
    });
    const once = new ReceivingStore({ sql: counting, blob: temp.blob });
    await once.receiveImage(pngOf(IMAGE), hash);
    expect(requests).toBe(1);
    await once.receiveImage(pngOf(IMAGE), hash);
    expect(requests).toBe(2);
  });
});

describe("getCheckedImage", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let store: Store;

  beforeEach(async () => {
    temp = await createTempStore();
    store = new Store({ sql: temp.sql, blob: temp.blob, codec: sharpCodec });
  });
  afterEach(() => temp.destroy());

  it("gives the stored file when it's the image its hash names", async () => {
    const { hash } = await store.putImage(pngOf(IMAGE));
    expect(await store.getCheckedImage(hash)).toEqual(await store.getImage(hash));
    expect(await store.getCheckedImage("e".repeat(64))).toBeNull();
  });

  it("refuses bytes that are another image, or that don't decode", async () => {
    const liar = "e".repeat(64);
    await store.receiveImage(pngOf(IMAGE), liar);
    await expect(store.getCheckedImage(liar)).rejects.toBeInstanceOf(ImageHashMismatchError);
    const broken = "f".repeat(64);
    await store.receiveImage(await corruptWebp(), broken);
    await expect(store.getCheckedImage(broken)).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
