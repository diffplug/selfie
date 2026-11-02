import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blobs, type BlobStorage } from "../../src/core/index.ts";

/** One empty blob store, created for one test. */
export interface BlobTestStore {
  /** Opens a new, separate client of this store. */
  open(): Promise<BlobStorage>;
  destroy(): Promise<void>;
}

export type BlobAdapterFactory = () => Promise<BlobTestStore>;

const bytesOf = (...values: number[]) => new Uint8Array(values);

/** Bytes that differ by position, so a truncated or shuffled blob can't pass. */
function patterned(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + (i >>> 8)) & 255;
  return bytes;
}

/** Run this with a factory to prove a new blob adapter correct. */
export function describeBlobContract(name: string, factory: BlobAdapterFactory): void {
  describe(`blob contract: ${name}`, () => {
    let store: BlobTestStore;
    let blob: Blobs;

    beforeEach(async () => {
      store = await factory();
      blob = new Blobs(await store.open());
    });

    afterEach(async () => {
      await store.destroy();
    });

    it("reports a missing key as absent", async () => {
      expect(await blob.has("images/missing")).toBe(false);
      expect(await blob.get("images/missing")).toBeNull();
    });

    it("reports the prefix or extension of a stored key as absent", async () => {
      await blob.put("images/nested/a", bytesOf(1));
      for (const key of ["images", "images/nested", "images/nested/a/b"]) {
        expect(await blob.has(key)).toBe(false);
        expect(await blob.get(key)).toBeNull();
      }
    });

    it("returns the bytes that were put", async () => {
      const bytes = patterned(4096);
      await blob.put("images/a", bytes);
      expect(await blob.has("images/a")).toBe(true);
      expect(await blob.get("images/a")).toEqual(bytes);
    });

    it("keeps zero-length bytes distinct from a missing key", async () => {
      await blob.put("images/empty", bytesOf());
      expect(await blob.has("images/empty")).toBe(true);
      expect(await blob.get("images/empty")).toEqual(bytesOf());
    });

    it("writes only the viewed range of a subarray", async () => {
      const whole = bytesOf(9, 9, 1, 2, 3, 9);
      await blob.put("images/view", whole.subarray(2, 5));
      expect(await blob.get("images/view")).toEqual(bytesOf(1, 2, 3));
    });

    it("keeps keys separate", async () => {
      await blob.put("images/a", bytesOf(1));
      await blob.put("images/b", bytesOf(2));
      expect(await blob.get("images/a")).toEqual(bytesOf(1));
      expect(await blob.get("images/b")).toEqual(bytesOf(2));
    });

    it("is idempotent when the same bytes are put again", async () => {
      const bytes = patterned(1024);
      await blob.put("images/a", bytes);
      await blob.put("images/a", bytes);
      expect(await blob.get("images/a")).toEqual(bytes);
    });

    it("is visible through another client", async () => {
      const other = new Blobs(await store.open());
      await blob.put("images/a", bytesOf(1, 2));
      expect(await other.get("images/a")).toEqual(bytesOf(1, 2));
    });

    it("survives concurrent puts of the same key through separate clients", async () => {
      const bytes = patterned(256 * 1024);
      const clients = await Promise.all(
        Array.from({ length: 8 }, async () => new Blobs(await store.open())),
      );
      await Promise.all(clients.map((client) => client.put("images/a", bytes)));
      expect(await blob.get("images/a")).toEqual(bytes);
    });

    it("never shows a partial blob to a concurrent reader", async () => {
      const bytes = patterned(4 * 1024 * 1024);
      const reader = new Blobs(await store.open());
      let finished = false;
      const reads = (async () => {
        const seen: (number | null)[] = [];
        while (!finished) {
          seen.push((await reader.get("images/a"))?.length ?? null);
        }
        return seen;
      })();
      await Promise.all([blob.put("images/a", bytes), blob.put("images/a", bytes)]);
      finished = true;
      for (const length of await reads) {
        expect([null, bytes.length]).toContain(length);
      }
    });

    it.each(["", "/absolute", "../escape", "images/../../escape", "images//a", "images/.hidden", "UPPER", "a\\b"])(
      "refuses the key %j on every operation",
      async (key) => {
        await expect(blob.put(key, bytesOf(1))).rejects.toThrow(RangeError);
        await expect(blob.get(key)).rejects.toThrow(RangeError);
        await expect(blob.has(key)).rejects.toThrow(RangeError);
      },
    );
  });
}
