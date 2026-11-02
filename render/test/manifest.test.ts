import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  storyFileName,
  toManifestStory,
  totalsOf,
  withRepeat,
  writeManifest,
  type Manifest,
} from "../src/manifest.ts";
import type { WorkerStoryResult } from "../src/worker/protocol.ts";

const entry = { id: "a--b", title: "A", name: "B" };
const okResult = (pngSha256 = "aaa"): WorkerStoryResult => ({
  id: "a--b",
  status: "ok",
  width: 10,
  height: 20,
  pngSha256,
  errors: [],
  durationMs: 5,
});
const failedResult: WorkerStoryResult = {
  id: "a--b",
  status: "failed",
  width: null,
  height: null,
  pngSha256: null,
  errors: [{ source: "render", message: "boom" }],
  durationMs: 5,
};

describe("storyFileName", () => {
  test("keeps an ordinary ID readable", () => {
    expect(storyFileName("app-wall--two-columns")).toBe("app-wall--two-columns.png");
  });

  test("can't leave its directory, whatever the build's index says", () => {
    for (const id of ["../../evil", "a/b", "..", "a\\b"]) {
      const file = storyFileName(id);
      expect(path.basename(file)).toBe(file);
      expect(path.resolve("/out", file).startsWith("/out/")).toBe(true);
    }
  });

  test("gives different IDs different files", () => {
    expect(storyFileName("a/b")).not.toBe(storyFileName("a%2Fb"));
    expect(storyFileName("a b")).not.toBe(storyFileName("a_b"));
  });
});

describe("toManifestStory", () => {
  test("points an ok story at its file", () => {
    expect(toManifestStory(entry, okResult(), null)).toEqual({
      id: "a--b",
      title: "A",
      name: "B",
      status: "ok",
      file: "stories/a--b.png",
      width: 10,
      height: 20,
      pngSha256: "aaa",
      errors: [],
      stability: "unchecked",
      repeatFile: null,
      durationMs: 5,
    });
  });

  test("gives a failed story no file and keeps its errors", () => {
    const story = toManifestStory(entry, failedResult, null);
    expect(story).toMatchObject({ status: "failed", file: null, width: null, height: null, pngSha256: null });
    expect(story.errors).toEqual([{ source: "render", message: "boom" }]);
  });

  test("reports a story the worker never reached as failed, with the crash", () => {
    const story = toManifestStory(entry, undefined, "worker exited with code 137");
    expect(story.status).toBe("failed");
    expect(story.errors).toEqual([{ source: "worker", message: "worker exited with code 137" }]);
  });
});

describe("withRepeat", () => {
  const first = toManifestStory(entry, okResult("aaa"), null);

  test("calls a matching PNG stable and keeps no second file", () => {
    expect(withRepeat(first, okResult("aaa"), null)).toMatchObject({ stability: "stable", repeatFile: null });
  });

  test("calls a differing PNG unstable and points at the second file", () => {
    expect(withRepeat(first, okResult("bbb"), null)).toMatchObject({
      stability: "unstable",
      repeatFile: "repeat/a--b.png",
    });
  });

  test("calls a story that failed its second render unstable", () => {
    const story = withRepeat(first, failedResult, null);
    expect(story).toMatchObject({ status: "ok", stability: "unstable", repeatFile: null });
    expect(story.errors).toEqual([{ source: "repeat", message: "boom" }]);
  });

  test("calls a story the second worker never reached unstable", () => {
    expect(withRepeat(first, undefined, "crashed").errors).toEqual([
      { source: "repeat", message: "crashed" },
    ]);
  });

  test("leaves a story that failed the first time unchecked", () => {
    const failed = toManifestStory(entry, failedResult, null);
    expect(withRepeat(failed, undefined, null).stability).toBe("unchecked");
  });
});

test("totalsOf counts stories, failures, and unstable stories", () => {
  const ok = toManifestStory(entry, okResult("aaa"), null);
  const stories = [
    ok,
    withRepeat(ok, okResult("aaa"), null),
    withRepeat(ok, okResult("bbb"), null),
    toManifestStory(entry, failedResult, null),
  ];
  expect(totalsOf(stories)).toEqual({ stories: 4, failed: 1, unstable: 1 });
});

test("writeManifest leaves only a complete, parseable manifest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfie-render-manifest-"));
  try {
    const manifest = { schemaVersion: 1, stories: [] } as unknown as Manifest;
    await writeManifest(dir, manifest);
    await writeManifest(dir, manifest);
    expect(await readdir(dir)).toEqual(["manifest.json"]);
    expect(JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"))).toEqual(manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
