import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blobs, initStoreSchema, BuiltStorybooks, RenderBatches, truncateHash, type BlobStorage } from "../src/core/index.ts";
import { fromHex } from "../src/core/image-hash.ts";
import { createTempStore } from "./support/temp-store.ts";

const BUILD = "a".repeat(64);
const OTHER = "b".repeat(64);
const text = (value: string) => new TextEncoder().encode(value);

describe("BuiltStorybooks", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let builds: BuiltStorybooks;

  let batch: string;
  let otherBatch: string;

  beforeEach(async () => {
    temp = await createTempStore();
    builds = new BuiltStorybooks({ sql: temp.sql, blob: temp.blob });
    const batches = new RenderBatches({ sql: temp.sql });
    const begin = async () => (await batches.beginBatch({ gitSha: "c".repeat(40), environment: "env", scale: 1, dirty: false })).id;
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

  it("knows the size an environment renders at, once a batch says", async () => {
    expect(await builds.viewportOf("env")).toBeNull();
    await builds.recordViewport("env", { width: 1200, height: 900 });
    await builds.recordViewport("env", { width: 640, height: 480 });
    expect(await builds.viewportOf("env")).toEqual({ width: 1200, height: 900 });
  });

  it("knows which of a batch's stories rendered at a size of their own", async () => {
    expect(await builds.storyViewportsOf(batch)).toEqual({});
    await builds.recordStoryViewports(batch, {});
    await builds.recordStoryViewports(batch, { "a--phone": { width: 414, height: 896 }, "a--tablet": { width: 834, height: 1112 } });
    await builds.recordStoryViewports(otherBatch, { "a--phone": { width: 320, height: 568 } });
    await builds.recordStoryViewports(batch, { "a--phone": { width: 1, height: 1 } });
    expect(await builds.storyViewportsOf(batch)).toEqual({ "a--phone": { width: 414, height: 896 }, "a--tablet": { width: 834, height: 1112 } });
    expect(await builds.storyViewportsOf(otherBatch)).toEqual({ "a--phone": { width: 320, height: 568 } });
  });

  it("keeps every story's size, past what fits in a statement", async () => {
    const viewports = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`story--${i}`, { width: 100 + i, height: 200 + i }]));
    await builds.recordStoryViewports(batch, viewports);
    expect(await builds.storyViewportsOf(batch)).toEqual(viewports);
  });

  it("takes nothing for a batch this store doesn't hold", async () => {
    await keep(BUILD, { "index.html": "page" });
    await expect(builds.recordBatchStorybook("00000000-0000-4000-8000-000000000009", BUILD)).rejects.toThrow(/doesn't hold/);
    await expect(builds.recordBatchStorybook(batch, OTHER)).rejects.toThrow(/doesn't hold/);
    await expect(builds.recordStoryViewports("00000000-0000-4000-8000-000000000009", { a: { width: 1, height: 1 } })).rejects.toThrow(/FOREIGN KEY/);
  });

  it("is safe to create twice", async () => {
    await initStoreSchema(temp.sql);
    await keep(BUILD, { "index.html": "page" });
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.has(BUILD)).toBe(true);
  });
});
