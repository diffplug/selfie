import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blobs, initStoreSchema, BuiltStorybooks, RenderBatches, gunzip, gzip, truncateHash, type BlobStorage } from "../src/core/index.ts";
import { fromHex, sha256, toHex } from "../src/core/image-hash.ts";
import { createTempStore } from "./support/temp-store.ts";

const BUILD = "a".repeat(64);
const OTHER = "b".repeat(64);
const text = (value: string) => new TextEncoder().encode(value);
const sha256Hex = async (bytes: Uint8Array) => toHex(await sha256(bytes as Uint8Array<ArrayBuffer>));

describe("BuiltStorybooks", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let builds: BuiltStorybooks;

  let batch: string;
  let otherBatch: string;

  beforeEach(async () => {
    temp = await createTempStore();
    builds = new BuiltStorybooks({ sql: temp.sql, blob: temp.blob });
    const batches = new RenderBatches({ sql: temp.sql });
    const begin = async () => (await batches.beginBatch({ gitSha: "c".repeat(40), environment: "env", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false })).id;
    batch = await begin();
    otherBatch = await begin();
  });
  afterEach(() => temp.destroy());

  const keep = async (build: string, files: Record<string, string>) => {
    await builds.putStorybook(
      build,
      await Promise.all(Object.entries(files).map(async ([path, body]) => ({ path, fileHash: await builds.putFile(text(body)) }))),
    );
  };

  it("gives back each file of a kept built Storybook", async () => {
    await keep(BUILD, { "index.html": "page", "assets/a.js": "script" });
    expect(await builds.has(BUILD)).toBe(true);
    expect(await builds.readFile(BUILD, "assets/a.js")).toEqual(text("script"));
    expect(await builds.readFile(BUILD, "assets/b.js")).toBeNull();
    expect(await builds.readFile(OTHER, "assets/a.js")).toBeNull();
  });

  it("keeps a file gzipped, under the hash of its bytes as built", async () => {
    const fileHash = await builds.putFile(text("script"));
    expect(fileHash).toBe(await sha256Hex(text("script")));
    await builds.putStorybook(BUILD, [{ path: "a.js", fileHash }]);
    const gzipped = await builds.readGzippedFile(BUILD, "a.js");
    expect(await gunzip(gzipped!)).toEqual(text("script"));
    expect(await temp.blob.get(`built-storybook-files-gzip/${fileHash}`)).toEqual(gzipped);
  });

  it("keeps a file sent gzipped as it came", async () => {
    const sent = await gzip(text("sent"));
    const fileHash = await sha256Hex(text("sent"));
    expect(await builds.putGzippedFile(sent, async () => fileHash)).toBe(fileHash);
    expect(await builds.missingFiles([fileHash])).toEqual([]);
    await builds.putStorybook(BUILD, [{ path: "sent.js", fileHash }]);
    expect(await builds.readGzippedFile(BUILD, "sent.js")).toEqual(sent);
    expect(await builds.readFile(BUILD, "sent.js")).toEqual(text("sent"));
  });

  it("holds one copy of a file two builds share, and keeps their paths apart", async () => {
    let puts = 0;
    const counted: BlobStorage = {
      put: (key, bytes) => {
        puts += 1;
        return temp.blob.put(key, bytes);
      },
      get: (key) => temp.blob.get(key),
      has: (key) => temp.blob.has(key),
    };
    builds = new BuiltStorybooks({ sql: temp.sql, blob: new Blobs(counted) });
    await keep(BUILD, { "shared.js": "same", "index.html": "first" });
    await keep(OTHER, { "renamed.js": "same", "index.html": "second" });
    // Three distinct files, and each build's list.
    expect(puts).toBe(5);
    expect(await builds.readFile(OTHER, "shared.js")).toBeNull();
    expect(await builds.readFile(OTHER, "renamed.js")).toEqual(text("same"));
    expect(await builds.readFile(BUILD, "index.html")).toEqual(text("first"));
  });

  it("says nothing of a build until its file list is written, however many files are here", async () => {
    const fileHash = await builds.putFile(text("page"));
    expect(await builds.has(BUILD)).toBe(false);
    expect(await builds.readFile(BUILD, "index.html")).toBeNull();
    await builds.putStorybook(BUILD, [{ path: "index.html", fileHash }]);
    expect(await builds.readFile(BUILD, "index.html")).toEqual(text("page"));
  });

  it("keeps the first answer about a build", async () => {
    await keep(BUILD, { "index.html": "first" });
    await keep(BUILD, { "index.html": "second" });
    expect(await builds.readFile(BUILD, "index.html")).toEqual(text("first"));
  });

  it("says which kept built Storybook rendered a batch", async () => {
    expect(await builds.storybookOfBatch(batch)).toBeNull();
    await keep(BUILD, { "index.html": "page" });
    await builds.recordBatchStorybook(batch, BUILD);
    expect(await builds.storybookOfBatch(batch)).toBe(BUILD);
    expect(await builds.storybookOfBatch(otherBatch)).toBeNull();
  });

  it("says a built Storybook is here from the table alone, and only once it's whole", async () => {
    expect(await builds.has(BUILD)).toBe(false);
    await temp.blob.put(`built-storybooks/${BUILD}`, text("{}"));
    expect(await builds.has(BUILD)).toBe(false);
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.has(BUILD)).toBe(true);
  });

  it("gives a built Storybook its key as an image's, and the next negative one on a collision", async () => {
    const keyOf = async (hash: string) => (await temp.sql.run({ sql: "SELECT key FROM built_storybooks WHERE hash = ?1", params: [hash] }))[0]?.key;
    const first = "0123456789abcd" + "0".repeat(50);
    const colliding = "0123456789abcd" + "1".repeat(50);
    await keep(first, { "index.html": "one" });
    await keep(colliding, { "index.html": "two" });
    expect(await keyOf(first)).toBe(truncateHash(fromHex(first)));
    expect(await keyOf(colliding)).toBe(-1);
    await keep(first, { "index.html": "again" });
    expect(await keyOf(first)).toBe(truncateHash(fromHex(first)));
  });

  it("reads files of more builds than it holds file lists for", async () => {
    const many = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, "0"));
    for (const build of many) await keep(build, { "index.html": build });
    for (const build of many) expect(await builds.readFile(build, "index.html")).toEqual(text(build));
  });

  it("treats a path as a name, and a bad build as nothing", async () => {
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.readFile(BUILD, "../index.html")).toBeNull();
    expect(await builds.readFile("nope", "index.html")).toBeNull();
    expect(await builds.readFile(BUILD, "__proto__")).toBeNull();
    await expect(builds.has("nope")).rejects.toThrow(RangeError);
  });

  it("takes nothing for a batch this store doesn't hold", async () => {
    await keep(BUILD, { "index.html": "page" });
    await expect(builds.recordBatchStorybook("00000000-0000-4000-8000-000000000009", BUILD)).rejects.toThrow(/doesn't hold/);
    await expect(builds.recordBatchStorybook(batch, OTHER)).rejects.toThrow(/doesn't hold/);
  });

  it("is safe to create twice", async () => {
    await initStoreSchema(temp.sql);
    await keep(BUILD, { "index.html": "page" });
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.has(BUILD)).toBe(true);
  });
});
