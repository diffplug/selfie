import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Blobs,
  encodePam,
  ImageDecodeError,
  Sql,
  sha256,
  ImageHashMismatchError,
  Store,
  toHex,
  type BlobStorage,
} from "../src/core/index.ts";
import { collidingHash, image } from "./support/colliding-hash.ts";
import { imageHashOf } from "./support/image-hash-of.ts";
import { pngOf } from "./support/png-builder.ts";
import { readPngFixture } from "./support/png-fixtures.ts";
import { createTempStore } from "./support/temp-store.ts";
import { sharpCodec } from "../src/adapters/sharp-codec.ts";
import { decodeImage } from "./support/decode.ts";

describe("Store", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;

  beforeEach(async () => {
    temp = await createTempStore();
  });

  afterEach(async () => {
    await temp.destroy();
  });

  const newStore = () => new Store({ codec: sharpCodec, sql: temp.sql, blob: temp.blob });

  const storeWith = (truncatedById: Record<number, number>) =>
    new Store({ codec: sharpCodec, sql: temp.sql, blob: temp.blob, hash: collidingHash(truncatedById) });

  const file = (id: number) => pngOf(image(id));

  /** Answers a lookup with no rows, and fails every other statement. */
  const failingInserts = () =>
    new Sql({
      execute: (statements) =>
        statements[0]!.sql.startsWith("SELECT")
          ? Promise.resolve([[]])
          : Promise.reject(new Error("sql down")),
    });

  /** The stored file for a hash, decoded back to what it holds. */
  const storedImage = async (store: Store, hash: string) =>
    decodeImage((await store.getImage(hash))!);

  describe("with the real hash", () => {
    it("reports the image hash of the PAM file", async () => {
      const store = newStore();
      const { hash } = await store.putImage(file(1));
      expect(hash).toBe(await imageHashOf(image(1)));
    });

    it("keeps one row and one key across repeated puts", async () => {
      const store = newStore();
      const first = await store.putImage(file(1));
      expect(await store.putImage(file(1))).toEqual(first);
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toHaveLength(1);
    });

    it("returns a file of the exact pixels for a stored image", async () => {
      const store = newStore();
      const { hash } = await store.putImage(file(1));
      expect(await decodeImage((await store.getImage(hash))!)).toEqual(image(1));
    });

    it("finds an image through a separate connection", async () => {
      const { hash, key } = await newStore().putImage(file(1));
      const other = new Store({ codec: sharpCodec, sql: temp.connect(), blob: temp.blob });
      expect(await other.lookupKey(hash)).toBe(key);
    });
  });

  describe("with an injected colliding hash", () => {
    it("gives the first image the truncated value and the next a negative key", async () => {
      const store = storeWith({ 1: 500, 2: 500, 3: 500 });
      expect((await store.putImage(file(1))).key).toBe(500);
      expect((await store.putImage(file(2))).key).toBe(-1);
      expect((await store.putImage(file(3))).key).toBe(-2);
    });

    it("assigns by arrival order, not by which image it is", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      expect((await store.putImage(file(2))).key).toBe(500);
      expect((await store.putImage(file(1))).key).toBe(-1);
    });

    it("sends a truncated value of 0 to a negative key", async () => {
      const store = storeWith({ 1: 0 });
      const { key, hash } = await store.putImage(file(1));
      expect(key).toBe(-1);
      expect(await store.lookupKey(hash)).toBe(-1);
    });

    it("returns the existing key for a repeated image holding a negative key", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      await store.putImage(file(1));
      const second = await store.putImage(file(2));
      expect(second.key).toBe(-1);
      expect(await store.putImage(file(2))).toEqual(second);
    });

    it("resolves each colliding image to its own key and bytes", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      const first = await store.putImage(file(1));
      const second = await store.putImage(file(2));
      expect(first.hash).not.toBe(second.hash);
      expect(await store.lookupKey(first.hash)).toBe(500);
      expect(await store.lookupKey(second.hash)).toBe(-1);
      expect(await storedImage(store, first.hash)).toEqual(image(1));
      expect(await storedImage(store, second.hash)).toEqual(image(2));
    });

    it("does not resolve an unstored image whose truncated value is claimed", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      await store.putImage(file(1));
      const absent = toHex(await collidingHash({ 2: 500 })(encodePam(image(2))));
      expect(await store.lookupKey(absent)).toBeNull();
      expect(await store.getImage(absent)).toBeNull();
    });

    it("leaves one key per image when colliding puts interleave", async () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8];
      const truncated = Object.fromEntries(ids.map((id) => [id, 500]));
      const stores = [temp.connect(), temp.connect(), temp.connect()].map(
        (sql) => new Store({ codec: sharpCodec, sql, blob: temp.blob, hash: collidingHash(truncated) }),
      );
      const results = await Promise.all(
        stores.flatMap((store) => ids.map((id) => store.putImage(file(id)))),
      );
      const keyOf = new Map<string, number>();
      for (const { hash, key } of results) {
        if (keyOf.has(hash)) expect(key).toBe(keyOf.get(hash));
        keyOf.set(hash, key);
      }
      expect([...keyOf.values()].sort((a, b) => b - a)).toEqual([500, -1, -2, -3, -4, -5, -6, -7]);
    });

    it("refuses a hash function that returns the wrong length", async () => {
      const store = new Store({
        codec: sharpCodec,
        sql: temp.sql,
        blob: temp.blob,
        hash: async () => new Uint8Array(20),
      });
      await expect(store.putImage(file(1))).rejects.toThrow(RangeError);
    });
  });

  describe("bytes before the row", () => {
    const failingBlob = (blob: BlobStorage): BlobStorage => ({
      has: (key) => blob.has(key),
      get: (key) => blob.get(key),
      put: () => Promise.reject(new Error("blob down")),
    });

    it("writes bytes before the row", async () => {
      const events: string[] = [];
      const store = new Store({
        codec: sharpCodec,
        sql: new Sql({
          execute: async (statements) => {
            events.push("sql");
            return statements.map(() => [{ key: 1 }]);
          },
        }),
        blob: new Blobs({
          has: async () => false,
          get: async () => null,
          put: async () => {
            events.push("blob");
          },
        }),
      });
      await store.putImage(file(1));
      // The lookup, the bytes, then the row.
      expect(events).toEqual(["sql", "blob", "sql"]);
    });

    it("leaves no row when the blob write fails", async () => {
      const store = new Store({ codec: sharpCodec, sql: temp.sql, blob: new Blobs(failingBlob(temp.blob)) });
      await expect(store.putImage(file(1))).rejects.toThrow("blob down");
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toEqual([]);
    });

    it("treats orphaned bytes as not stored, and an insert retry adopts them", async () => {
      const broken = new Store({ codec: sharpCodec, sql: failingInserts(), blob: temp.blob });
      await expect(broken.putImage(file(1))).rejects.toThrow("sql down");

      const store = newStore();
      const hash = await imageHashOf(image(1));
      expect(await temp.blob.has(`images/${hash}`)).toBe(true);
      expect(await store.getImage(hash)).toBeNull();

      expect((await store.putImage(file(1))).hash).toBe(hash);
      expect(await storedImage(store, hash)).toEqual(image(1));
    });

    it("reports a row with no bytes rather than treating it as absent", async () => {
      const store = newStore();
      const hash = "ab".repeat(32);
      await temp.sql.run({
        sql: "INSERT INTO images(key, hash) VALUES (CAST(?1 AS INTEGER), ?2)",
        params: [5, hash],
      });
      await expect(store.getImage(hash)).rejects.toThrow("no bytes");
    });
  });

  describe("putImages", () => {
    it("returns each image in order, including repeats and collisions", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      const stored = await store.putImages([file(1), file(2), file(1), file(3)]);
      expect(stored.map(({ key }) => key)).toEqual([500, -1, 500, 1003]);
      expect(stored[0]!.hash).toBe(stored[2]!.hash);
      expect(await storedImage(store, stored[1]!.hash)).toEqual(image(2));
    });

    it("returns nothing and sends nothing for no images", async () => {
      const store = new Store({
        codec: sharpCodec,
        sql: new Sql({ execute: () => Promise.reject(new Error("no SQL expected")) }),
        blob: temp.blob,
      });
      expect(await store.putImages([])).toEqual([]);
    });

    it("sends a lookup and an insert per 100 images, with bytes before each group's rows", async () => {
      const requests: string[] = [];
      let inserted = 0;
      let blobsWritten = 0;
      const files = Array.from({ length: 250 }, (_, i) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([i & 255, i >> 8, 0]) }),
      );
      const store = new Store({
        codec: sharpCodec,
        sql: new Sql({
          execute: async (statements) => {
            if (statements[0]!.sql.startsWith("SELECT")) {
              requests.push(`lookup ${statements[0]!.params!.length}`);
              return [[]];
            }
            requests.push(`insert ${statements.length}`);
            inserted += statements.length;
            expect(blobsWritten).toBe(inserted);
            return statements.map((_, i) => [{ key: i + 1 }]);
          },
        }),
        blob: new Blobs({
          has: async () => false,
          get: async () => null,
          put: async () => {
            blobsWritten++;
          },
        }),
      });
      expect(await store.putImages(files)).toHaveLength(250);
      expect(requests).toEqual([
        "lookup 100",
        "insert 100",
        "lookup 100",
        "insert 100",
        "lookup 50",
        "insert 50",
      ]);
    });

    it("sends one SQL request and no blob calls for a group already stored", async () => {
      const files = Array.from({ length: 100 }, (_, i) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([i, 1, 0]) }),
      );
      const stored = await newStore().putImages(files);

      let requests = 0;
      const noBlobCalls = (): never => {
        throw new Error("no blob calls expected");
      };
      const store = new Store({
        codec: sharpCodec,
        sql: new Sql({
          execute: (statements) => {
            requests++;
            return temp.connect().batch(statements);
          },
        }),
        blob: new Blobs({ has: noBlobCalls, get: noBlobCalls, put: noBlobCalls }),
      });
      expect(await store.putImages(files)).toEqual(stored);
      expect(requests).toBe(1);
    });

    it("looks up only what's new, and inserts a repeat once", async () => {
      const seen: { sql: string; params: number }[] = [];
      const counting = new Sql({
        execute: (statements) => {
          seen.push(...statements.map(({ sql, params = [] }) => ({ sql, params: params.length })));
          return temp.connect().batch(statements);
        },
      });
      const store = new Store({ codec: sharpCodec, sql: counting, blob: temp.blob });
      const first = await store.putImage(file(1));
      seen.length = 0;
      const stored = await store.putImages([file(1), file(2), file(2)]);
      expect(stored[0]).toEqual(first);
      expect(stored[1]).toEqual(stored[2]);
      expect(seen.map(({ sql }) => sql.slice(0, 6))).toEqual(["SELECT", "INSERT"]);
      expect(seen[0]!.params).toBe(2);
    });

    it("decodes a whole group before writing any of it", async () => {
      const transparent = pngOf(image(9), { alpha: () => 128 });
      const store = newStore();
      await expect(store.putImages([file(1), transparent])).rejects.toThrow(ImageDecodeError);
      expect(await temp.blob.has(`images/${await imageHashOf(image(1))}`)).toBe(false);
    });

    it("can be called again after failing partway", async () => {
      let failures = 1;
      const flaky = new Sql({
        execute: (statements) => {
          if (failures-- > 0) return Promise.reject(new Error("sql down"));
          return temp.connect().batch(statements);
        },
      });
      const store = new Store({ codec: sharpCodec, sql: flaky, blob: temp.blob });
      await expect(store.putImages([file(1), file(2)])).rejects.toThrow("sql down");
      expect((await store.putImages([file(1), file(2)])).map(({ hash }) => hash)).toHaveLength(2);
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toHaveLength(2);
    });
  });

  describe("with image files", () => {
    const screenshot = () => new Uint8Array(readPngFixture("chromium-update-banner.png"));
    const plain = file(9);
    const reencoded = pngOf(image(9), { filters: [4] });
    const withAlpha = pngOf(image(9), { alpha: () => 255 });
    const transparent = pngOf(image(9), { alpha: () => 128 });

    it("hashes the decoded pixels, never the file", async () => {
      const png = screenshot();
      const { hash } = await newStore().putImage(png);
      expect(hash).toBe(await imageHashOf(await decodeImage(png)));
      expect(hash).not.toBe(toHex(await sha256(png as Uint8Array<ArrayBuffer>)));
    });

    it("gives bytes that decode to the pixels that were hashed", async () => {
      const store = newStore();
      const { hash } = await store.putImage(screenshot());
      expect(await imageHashOf(await storedImage(store, hash))).toBe(hash);
    });

    it("gives every encoding of some pixels one hash, key and row", async () => {
      const store = newStore();
      const first = await store.putImage(plain);
      expect(await store.putImage(reencoded)).toEqual(first);
      expect(await store.putImage(withAlpha)).toEqual(first);
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toHaveLength(1);
    });

    // Two encodings of one screenshot: a store keeps a WebP as those exact bytes.
    const twoWebps = async () => {
      const { width, height, pixels } = await decodeImage(screenshot());
      const encode = (effort: number) =>
        sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ lossless: true, effort }).toBuffer();
      const [first, second] = await Promise.all([encode(0), encode(6)]);
      expect(first).not.toEqual(second);
      return [new Uint8Array(first), new Uint8Array(second)] as const;
    };

    it("keeps the first bytes stored for a hash", async () => {
      const store = newStore();
      const [first, second] = await twoWebps();
      const { hash } = await store.putImage(first);
      await store.putImage(second);
      expect(await store.getImage(hash)).toEqual(first);
    });

    it("keeps the first of two encodings in one call", async () => {
      const store = newStore();
      const [first, second] = await twoWebps();
      const [stored, again] = await store.putImages([first, second]);
      expect(stored).toEqual(again);
      expect(await store.getImage(stored!.hash)).toEqual(first);
    });

    it("adopts orphaned bytes rather than replacing them", async () => {
      const [first, second] = await twoWebps();
      const broken = new Store({ codec: sharpCodec, sql: failingInserts(), blob: temp.blob });
      await expect(broken.putImage(first)).rejects.toThrow("sql down");
      const { hash } = await newStore().putImage(second);
      expect(await newStore().getImage(hash)).toEqual(first);
    });

    it("writes nothing for a refused file", async () => {
      await expect(newStore().putImage(transparent)).rejects.toThrow(ImageDecodeError);
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toEqual([]);
    });

    it("stops a call at a refused file, keeping the groups already written", async () => {
      const good = Array.from({ length: 100 }, (_, i) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([i, 2, 0]) }),
      );
      await expect(newStore().putImages([...good, transparent])).rejects.toThrow(ImageDecodeError);
      expect(await temp.sql.run({ sql: "SELECT key FROM images" })).toHaveLength(100);
    });
  });

  describe("missingImages", () => {
    it("says which it doesn't hold, in the order asked, across query groups", async () => {
      const store = storeWith({});
      const { hash } = await store.putImage(file(1));
      const absent = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(64, "f"));
      expect(await store.missingImages([...absent.slice(0, 120), hash, ...absent.slice(120)])).toEqual(absent);
      expect(await store.missingImages([hash])).toEqual([]);
      expect(await store.missingImages([])).toEqual([]);
    });

    it("refuses what isn't a hash", async () => {
      await expect(storeWith({}).missingImages(["nope"])).rejects.toThrow();
    });

    it("won't store bytes as a different image from what they are", async () => {
      const store = storeWith({});
      const absent = "f".repeat(64);
      const { hash } = await storeWith({}).putImage(file(1));
      await expect(store.putImage(file(2), absent)).rejects.toThrow(ImageHashMismatchError);
      expect(await store.putImage(file(1), hash)).toMatchObject({ hash });
    });

    it("asks once for each distinct hash, however often it's named", async () => {
      const store = storeWith({});
      const { hash } = await store.putImage(file(1));
      expect(await store.missingImages([hash, hash])).toEqual([]);
      const absent = "f".repeat(64);
      expect(await store.missingImages([absent, absent])).toEqual([absent]);
    });
  });

  describe("lookups by image hash", () => {
    it.each(["", "abc", "AB".repeat(32), "zz".repeat(32), `${"ab".repeat(32)}00`])(
      "refuses %j",
      async (hash) => {
        const store = newStore();
        await expect(store.lookupKey(hash)).rejects.toThrow(RangeError);
        await expect(store.getImage(hash)).rejects.toThrow(RangeError);
      },
    );
  });
});
