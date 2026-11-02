import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderEnvironment } from "./environment.ts";
import type { StoryEntry } from "./storybook.ts";
import type { CAPTURE_RECIPE, StoryError, WorkerRuntime, WorkerStoryResult } from "./worker/protocol.ts";

export const MANIFEST_FILE = "manifest.json";
export const STORIES_DIR = "stories";
/** The second render of each unstable story, so it can be compared with the first. */
export const REPEAT_DIR = "repeat";

export type StabilityStatus = "stable" | "unstable" | "unchecked";

export interface ManifestStory {
  id: string;
  title: string;
  name: string;
  status: "ok" | "failed";
  /** Relative to the manifest. Null when the story failed. */
  file: string | null;
  width: number | null;
  height: number | null;
  /** SHA256 of the PNG file. Not the image hash, which `docs/specs/store.md` defines over pixels. */
  pngSha256: string | null;
  /** May be non-empty on an `ok` story, such as a console error that didn't stop the render. */
  errors: StoryError[];
  stability: StabilityStatus;
  /** Relative to the manifest. Only on an unstable story whose second render succeeded. */
  repeatFile: string | null;
  durationMs: number;
}

export interface ManifestTotals {
  stories: number;
  ok: number;
  failed: number;
  stable: number;
  unstable: number;
  unchecked: number;
}

export interface Manifest {
  schemaVersion: 1;
  environmentId: string;
  environment: RenderEnvironment;
  recipe: typeof CAPTURE_RECIPE;
  /** What actually ran. Null when no story needed a browser. */
  runtime: WorkerRuntime | null;
  launchArgs: string[];
  init: { global: string; scriptSha256: string | null; cssSha256: string | null };
  stabilityChecked: boolean;
  startedAt: string;
  durationMs: number;
  warnings: string[];
  totals: ManifestTotals;
  stories: ManifestStory[];
}

/** A file name for a story ID. Story IDs come from the project's build, so `/` must not survive. */
export function storyFileName(id: string): string {
  return `${encodeURIComponent(id)}.png`;
}

/** The manifest entry for one story, where a missing result means the worker never reported it. */
export function toManifestStory(
  story: StoryEntry,
  result: WorkerStoryResult | undefined,
  crash: string | null,
): ManifestStory {
  const base = {
    id: story.id,
    title: story.title,
    name: story.name,
    stability: "unchecked" as const,
    repeatFile: null,
  };
  if (!result) {
    const message = crash ?? "the worker never reported this story";
    return {
      ...base,
      status: "failed",
      file: null,
      width: null,
      height: null,
      pngSha256: null,
      errors: [{ source: "worker", message }],
      durationMs: 0,
    };
  }
  const { status, width, height, pngSha256, errors, durationMs } = result;
  return {
    ...base,
    status,
    file: status === "ok" ? path.posix.join(STORIES_DIR, storyFileName(story.id)) : null,
    width,
    height,
    pngSha256,
    errors,
    durationMs,
  };
}

/** Applies a second render to a story. A failed story stays unchecked, since it has no first image. */
export function withRepeat(
  story: ManifestStory,
  repeat: WorkerStoryResult | undefined,
  crash: string | null,
): ManifestStory {
  if (story.status === "failed") return story;
  if (!repeat) {
    const message = crash ?? "the worker never reported this story";
    return { ...story, stability: "unstable", errors: [...story.errors, { source: "repeat", message }] };
  }
  if (repeat.status === "failed") {
    const message = repeat.errors.map((error) => error.message).join("; ") || "second render failed";
    return { ...story, stability: "unstable", errors: [...story.errors, { source: "repeat", message }] };
  }
  if (repeat.pngSha256 === story.pngSha256) return { ...story, stability: "stable" };
  return {
    ...story,
    stability: "unstable",
    repeatFile: path.posix.join(REPEAT_DIR, storyFileName(story.id)),
  };
}

export function totalsOf(stories: ManifestStory[]): ManifestTotals {
  const count = (test: (story: ManifestStory) => boolean) => stories.filter(test).length;
  return {
    stories: stories.length,
    ok: count((story) => story.status === "ok"),
    failed: count((story) => story.status === "failed"),
    stable: count((story) => story.stability === "stable"),
    unstable: count((story) => story.stability === "unstable"),
    unchecked: count((story) => story.stability === "unchecked"),
  };
}

/** Atomic, so a reader never sees half a manifest. */
export async function writeManifest(outDir: string, manifest: Manifest): Promise<void> {
  const target = path.join(outDir, MANIFEST_FILE);
  await writeFile(`${target}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}
