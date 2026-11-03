import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blobs, initStoreSchema, StorybookBuilds, type BlobStorage } from "../src/core/index.ts";
import { createTempStore } from "./support/temp-store.ts";

const BUILD = "a".repeat(64);
const OTHER = "b".repeat(64);
const text = (value: string) => new TextEncoder().encode(value);

describe("StorybookBuilds", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let builds: StorybookBuilds;

  beforeEach(async () => {
    temp = await createTempStore();
    builds = new StorybookBuilds({ sql: temp.sql, blob: temp.blob });
  });
  afterEach(() => temp.destroy());

  const keep = async (build: string, files: Record<string, string>) => {
    await builds.putBuild(
      build,
      await Promise.all(Object.entries(files).map(async ([path, body]) => ({ path, fileHash: await builds.putFile(text(body)) }))),
    );
  };

  it("gives back each file of a kept build", async () => {
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
    builds = new StorybookBuilds({ sql: temp.sql, blob: new Blobs(counted) });
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
    await builds.putBuild(BUILD, [{ path: "index.html", fileHash }]);
    expect(await builds.readFile(BUILD, "index.html")).toEqual(text("page"));
  });

  it("keeps the first answer about a build", async () => {
    await keep(BUILD, { "index.html": "first" });
    await keep(BUILD, { "index.html": "second" });
    expect(await builds.readFile(BUILD, "index.html")).toEqual(text("first"));
  });

  it("knows a run's build only once it's kept", async () => {
    expect(await builds.keptBuildOfRun("run")).toBeNull();
    await builds.recordRunBuild("run", BUILD);
    expect(await builds.keptBuildOfRun("run")).toBeNull();
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.keptBuildOfRun("run")).toBe(BUILD);
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
    expect(() => builds.has("nope")).toThrow(RangeError);
  });

  it("is safe to create twice", async () => {
    await initStoreSchema(temp.sql);
    await keep(BUILD, { "index.html": "page" });
    await keep(BUILD, { "index.html": "page" });
    expect(await builds.has(BUILD)).toBe(true);
  });
});
