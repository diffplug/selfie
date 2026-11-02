import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderEnvironment } from "./environment.ts";
import type { StoryEntry } from "./storybook.ts";
import type { CAPTURE_RECIPE, StoryError, WorkerRuntime, WorkerStoryResult } from "./worker/protocol.ts";

export const MANIFEST_FILE = "manifest.json";
export const STORIES_DIR = "stories";
/** The second render of each unstable story, so it can be compared with the first. */
export const REPEAT_DIR = "repeat";

const UNREPORTED = "the worker never reported this story";

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
  failed: number;
  unstable: number;
}

export interface Manifest {
  schemaVersion: 1;
  environmentId: string;
  environment: RenderEnvironment;
  recipe: typeof CAPTURE_RECIPE;
  /** Project input rather than environment, so outside the environment ID. */
  settleMs: number;
  initScriptSha256: string | null;
  /** What actually ran. Null when no story needed a browser. */
  runtime: WorkerRuntime | null;
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
  { id, title, name }: StoryEntry,
  result: WorkerStoryResult | undefined,
  crash: string | null,
): ManifestStory {
  const { status, width, height, pngSha256, errors, durationMs } = result ?? {
    status: "failed" as const,
    width: null,
    height: null,
    pngSha256: null,
    errors: [{ source: "worker" as const, message: crash ?? UNREPORTED }],
    durationMs: 0,
  };
  return {
    id,
    title,
    name,
    status,
    file: status === "ok" ? path.posix.join(STORIES_DIR, storyFileName(id)) : null,
    width,
    height,
    pngSha256,
    errors,
    stability: "unchecked",
    repeatFile: null,
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
  if (repeat?.status === "ok") {
    return repeat.pngSha256 === story.pngSha256
      ? { ...story, stability: "stable" }
      : { ...story, stability: "unstable", repeatFile: path.posix.join(REPEAT_DIR, storyFileName(story.id)) };
  }
  const message = repeat ? repeat.errors.map((error) => error.message).join("; ") : (crash ?? UNREPORTED);
  return { ...story, stability: "unstable", errors: [...story.errors, { source: "repeat", message }] };
}

export function totalsOf(stories: ManifestStory[]): ManifestTotals {
  return {
    stories: stories.length,
    failed: stories.filter((story) => story.status === "failed").length,
    unstable: stories.filter((story) => story.stability === "unstable").length,
  };
}

/** Atomic, so a reader never sees half a manifest. */
export async function writeManifest(outDir: string, manifest: Manifest): Promise<void> {
  const target = path.join(outDir, MANIFEST_FILE);
  await writeFile(`${target}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}
