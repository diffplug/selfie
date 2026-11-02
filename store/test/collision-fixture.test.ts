import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePam, sha256, Store, toHex, truncateHash, type RawImage } from "../src/core/index.ts";
import { createTempStore } from "./support/temp-store.ts";

// Real images from scripts/find-collision.ts. Nothing about them is trusted: only
// the image bytes are committed, and both hashes are computed here.

function readFixture(name: string): { file: Uint8Array; image: RawImage } {
  const url = new URL(`./fixtures/collision-53bit/${name}`, import.meta.url);
  const file = new Uint8Array(readFileSync(url));
  const end = "ENDHDR\n";
  const header = new TextDecoder("latin1").decode(file).split(end)[0]! + end;
  const dimension = (field: string) => Number(new RegExp(`^${field} (\\d+)$`, "m").exec(header)?.[1]);
  return {
    file,
    image: {
      width: dimension("WIDTH"),
      height: dimension("HEIGHT"),
      pixels: file.subarray(header.length),
    },
  };
}

describe("committed 53-bit collision", () => {
  const a = readFixture("a.pam");
  const b = readFixture("b.pam");

  it("is two different images, each in canonical form", () => {
    expect(a.file).not.toEqual(b.file);
    expect(encodePam(a.image)).toEqual(a.file);
    expect(encodePam(b.image)).toEqual(b.file);
  });

  it("has different full hashes with the same first 53 bits", async () => {
    const hashA = await sha256(encodePam(a.image));
    const hashB = await sha256(encodePam(b.image));
    expect(toHex(hashA)).not.toBe(toHex(hashB));
    expect(truncateHash(hashA)).toBe(truncateHash(hashB));
    // Independent of truncateHash, in case it ever stops using all 53 bits.
    expect(BigInt(`0x${toHex(hashA)}`) >> 203n).toBe(BigInt(`0x${toHex(hashB)}`) >> 203n);
    expect(truncateHash(hashA)).toBeGreaterThan(0);
  });

  describe("through the store with the real hash", () => {
    let temp: Awaited<ReturnType<typeof createTempStore>>;
    let store: Store;

    beforeEach(async () => {
      temp = await createTempStore();
      store = new Store({ sql: temp.sql, blob: temp.blob });
    });

    afterEach(async () => {
      await temp.destroy();
    });

    it("gives the first image its truncated value and the second key -1", async () => {
      const first = await store.putImage(a.image);
      const second = await store.putImage(b.image);
      expect(first.key).toBe(truncateHash(await sha256(a.file as Uint8Array<ArrayBuffer>)));
      expect(second.key).toBe(-1);
    });

    it("keeps each image's key and bytes separate", async () => {
      const first = await store.putImage(a.image);
      const second = await store.putImage(b.image);
      expect(await store.putImage(a.image)).toEqual(first);
      expect(await store.putImage(b.image)).toEqual(second);
      expect(await store.lookupKey(first.hash)).toBe(first.key);
      expect(await store.lookupKey(second.hash)).toBe(-1);
      expect(await store.getImage(first.hash)).toEqual(a.file);
      expect(await store.getImage(second.hash)).toEqual(b.file);
    });

    it("does not resolve the second image before it is stored", async () => {
      await store.putImage(a.image);
      const hash = toHex(await sha256(encodePam(b.image)));
      expect(await store.lookupKey(hash)).toBeNull();
    });
  });
});
