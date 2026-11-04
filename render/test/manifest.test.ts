import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  storyFileName,
  toManifestStory,
  totalsOf,
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
  viewport: { width: 1200, height: 900 },
  pngSha256,
  errors: [],
  durationMs: 5,
});
const failedResult: WorkerStoryResult = {
  id: "a--b",
  status: "failed",
  width: null,
  height: null,
  viewport: { width: 1200, height: 900 },
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
      viewport: { width: 1200, height: 900 },
      pngSha256: "aaa",
      errors: [],
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

test("totalsOf counts stories and failures", () => {
  const ok = toManifestStory(entry, okResult("aaa"), null);
  const stories = [ok, ok, toManifestStory(entry, failedResult, null)];
  expect(totalsOf(stories)).toEqual({ stories: 3, failed: 1 });
});
