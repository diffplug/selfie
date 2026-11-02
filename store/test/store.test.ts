import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodePam,
  Sql,
  sha256,
  Store,
  toHex,
  type BlobStorage,
  type RawImage,
} from "../src/core/index.ts";
import { collidingHash } from "./support/colliding-hash.ts";
import { createTempStore } from "./support/temp-store.ts";

/** A 1×1 image whose red channel identifies it. */
const image = (id: number): RawImage => ({
  width: 1,
  height: 1,
  pixels: new Uint8Array([id, 0, 0, 255]),
});

describe("Store", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;

  beforeEach(async () => {
    temp = await createTempStore();
  });

  afterEach(async () => {
    await temp.destroy();
  });

  const storeWith = (truncatedById: Record<number, number>) =>
    new Store({ sql: temp.sql, blob: temp.blob, hash: collidingHash(truncatedById) });

  describe("with the real hash", () => {
    it("reports the image hash of the PAM file", async () => {
      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const { hash } = await store.putImage(image(1));
      expect(hash).toBe(toHex(await sha256(encodePam(image(1)))));
    });

    it("keeps one row and one key across repeated puts", async () => {
      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const first = await store.putImage(image(1));
      expect(await store.putImage(image(1))).toEqual(first);
      expect(await temp.sql.run("SELECT key FROM images")).toHaveLength(1);
    });

    it("returns the PAM file for a stored image", async () => {
      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const { hash } = await store.putImage(image(1));
      expect(await store.getImage(hash)).toEqual(encodePam(image(1)));
    });

    it("finds an image through a separate connection", async () => {
      const { hash, key } = await new Store({ sql: temp.sql, blob: temp.blob }).putImage(image(1));
      const other = new Store({ sql: temp.connect(), blob: temp.blob });
      expect(await other.lookupKey(hash)).toBe(key);
    });
  });

  describe("with an injected colliding hash", () => {
    it("gives the first image the truncated value and the next a negative key", async () => {
      const store = storeWith({ 1: 500, 2: 500, 3: 500 });
      expect((await store.putImage(image(1))).key).toBe(500);
      expect((await store.putImage(image(2))).key).toBe(-1);
      expect((await store.putImage(image(3))).key).toBe(-2);
    });

    it("assigns by arrival order, not by which image it is", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      expect((await store.putImage(image(2))).key).toBe(500);
      expect((await store.putImage(image(1))).key).toBe(-1);
    });

    it("sends a truncated value of 0 to a negative key", async () => {
      const store = storeWith({ 1: 0 });
      const { key, hash } = await store.putImage(image(1));
      expect(key).toBe(-1);
      expect(await store.lookupKey(hash)).toBe(-1);
    });

    it("returns the existing key for a repeated image holding a negative key", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      await store.putImage(image(1));
      const second = await store.putImage(image(2));
      expect(second.key).toBe(-1);
      expect(await store.putImage(image(2))).toEqual(second);
    });

    it("resolves each colliding image to its own key and bytes", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      const first = await store.putImage(image(1));
      const second = await store.putImage(image(2));
      expect(first.hash).not.toBe(second.hash);
      expect(await store.lookupKey(first.hash)).toBe(500);
      expect(await store.lookupKey(second.hash)).toBe(-1);
      expect(await store.getImage(first.hash)).toEqual(encodePam(image(1)));
      expect(await store.getImage(second.hash)).toEqual(encodePam(image(2)));
    });

    it("does not resolve an unstored image whose truncated value is claimed", async () => {
      const store = storeWith({ 1: 500, 2: 500 });
      await store.putImage(image(1));
      const absent = toHex(await collidingHash({ 2: 500 })(encodePam(image(2))));
      expect(await store.lookupKey(absent)).toBeNull();
      expect(await store.getImage(absent)).toBeNull();
    });

    it("leaves one key per image when colliding puts interleave", async () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8];
      const truncated = Object.fromEntries(ids.map((id) => [id, 500]));
      const stores = [temp.connect(), temp.connect(), temp.connect()].map(
        (sql) => new Store({ sql, blob: temp.blob, hash: collidingHash(truncated) }),
      );
      const results = await Promise.all(
        stores.flatMap((store) => ids.map((id) => store.putImage(image(id)))),
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
        sql: temp.sql,
        blob: temp.blob,
        hash: async () => new Uint8Array(20),
      });
      await expect(store.putImage(image(1))).rejects.toThrow(RangeError);
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
        sql: new Sql({
          execute: async (statements) => {
            events.push("sql");
            return statements.map(() => [{ key: 1 }]);
          },
        }),
        blob: {
          has: async () => false,
          get: async () => null,
          put: async () => {
            events.push("blob");
          },
        },
      });
      await store.putImage(image(1));
      expect(events).toEqual(["blob", "sql"]);
    });

    it("leaves no row when the blob write fails", async () => {
      const store = new Store({ sql: temp.sql, blob: failingBlob(temp.blob) });
      await expect(store.putImage(image(1))).rejects.toThrow("blob down");
      expect(await temp.sql.run("SELECT key FROM images")).toEqual([]);
    });

    it("treats orphaned bytes as not stored, and an insert retry adopts them", async () => {
      const failingSql = new Sql({ execute: () => Promise.reject(new Error("sql down")) });
      const broken = new Store({ sql: failingSql, blob: temp.blob });
      await expect(broken.putImage(image(1))).rejects.toThrow("sql down");

      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const hash = toHex(await sha256(encodePam(image(1))));
      expect(await temp.blob.has(`images/${hash}`)).toBe(true);
      expect(await store.getImage(hash)).toBeNull();

      expect((await store.putImage(image(1))).hash).toBe(hash);
      expect(await store.getImage(hash)).toEqual(encodePam(image(1)));
    });

    it("reports a row with no bytes rather than treating it as absent", async () => {
      const store = new Store({ sql: temp.sql, blob: temp.blob });
      const hash = "ab".repeat(32);
      await temp.sql.run("INSERT INTO images(key, hash) VALUES (CAST(?1 AS INTEGER), ?2)", [5, hash]);
      await expect(store.getImage(hash)).rejects.toThrow("no bytes");
    });
  });

  describe("lookups by image hash", () => {
    it.each(["", "abc", "AB".repeat(32), "zz".repeat(32), `${"ab".repeat(32)}00`])(
      "refuses %j",
      async (hash) => {
        const store = new Store({ sql: temp.sql, blob: temp.blob });
        await expect(store.lookupKey(hash)).rejects.toThrow(RangeError);
        await expect(store.getImage(hash)).rejects.toThrow(RangeError);
      },
    );
  });
});
