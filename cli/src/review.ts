import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import {
  capture as realCapture,
  filterStories,
  type Manifest,
  type ManifestStory,
  type StoryError,
} from "selfie-render";
import {
  chunks,
  ImageDecodeError,
  type ComparedSnapshot,
  type Comparison,
  type Decision,
  type RecordedSnapshot,
  type StoryFilter,
} from "selfie-store";
import { resolveCaptureSettings, type CaptureSettings } from "./config.ts";
import { diffFiles, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { dirtyPaths, headSha, type BaselineSearch } from "./git.ts";
import { regularFileInside, storyDirName } from "./paths.ts";
import {
  captureDirectory,
  findBaseline,
  pruneOutput,
  runDirectory,
  writeReviewCache,
  type Project,
} from "./project.ts";
import { isDecidable, summarizeRun } from "./summary.ts";

/** Each group is read into memory whole. */
const IMAGES_PER_GROUP = 100;
const MAX_CONCURRENT_DIFFS = 6;

export interface ReviewOptions {
  /** Relative to the project's `cwd`. */
  readonly storybookDir: string;
  /** The caller's own command, run in a shell. Its stdout goes to stderr. */
  readonly buildCommand?: string | undefined;
  /** Story ID patterns. Defaults to every story. */
  readonly stories?: readonly string[] | undefined;
  readonly stability?: boolean | undefined;
  readonly native?: boolean | undefined;
  /** Defaults to the renderer's. */
  readonly capture?: typeof realCapture | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Progress for people. Defaults to nothing. */
  readonly log?: ((line: string) => void) | undefined;
}

export interface Difference {
  readonly story: string;
  readonly state: "changed" | "new" | "removed";
  readonly decision: Decision | null;
  readonly imageHash: string | null;
  readonly goldenHash: string | null;
  /** Absolute paths. `current` is null if removed, `golden` if new, `diff` unless pixels could be compared. */
  readonly current: string | null;
  readonly golden: string | null;
  readonly diff: string | null;
  /** Null unless `changed`. */
  readonly pixelDiff: PixelDiff | null;
}

export interface ReviewResult {
  /** Everything about the run, as `summarizeRun` reads it. */
  readonly comparison: Comparison;
  /** Modified, staged, and untracked paths while it rendered. */
  readonly dirtyPaths: readonly string[];
  readonly baseline: BaselineSearch;
  readonly stabilityChecked: boolean;
  /** Within the run's filter. */
  readonly differences: readonly Difference[];
  readonly playErrors: readonly {
    readonly story: string;
    readonly playError: string;
    readonly current: string | null;
  }[];
  readonly unstable: readonly {
    readonly story: string;
    readonly current: string | null;
    /** The second render, if it succeeded. */
    readonly repeat: string | null;
  }[];
  readonly warnings: readonly string[];
  readonly timings: {
    readonly captureMs: number;
    readonly storeMs: number;
    readonly compareMs: number;
    readonly diffMs: number;
    readonly totalMs: number;
  };
}

function runBuildCommand(command: string, cwd: string, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, stdio: ["ignore", 2, 2], ...(signal ? { signal } : {}) });
    child.once("error", (error) =>
      reject(new SelfieError("build-failed", `The build command couldn't run: ${error.message}`)),
    );
    child.once("close", (code, killedBy) => {
      if (code === 0) resolve();
      else reject(new SelfieError("build-failed", `The build command failed with ${killedBy ?? `exit code ${code}`}.`));
    });
  });
}

/** No stories means nothing to record, and a typo must not pass. */
function assertStoriesCaptured(manifest: Manifest, storybookDir: string, stories: readonly string[] | undefined) {
  if (manifest.stories.length > 0) return;
  throw new SelfieError(
    "no-stories",
    stories === undefined
      ? `The Storybook at ${storybookDir} has no stories.`
      : `No story matched ${stories.join(", ")}.`,
  );
}

const describeErrors = (errors: readonly StoryError[]) =>
  errors.map(({ source, message }) => `${source}: ${message}`).join("; ") || "The story failed to render.";

const playErrorOf = ({ errors }: ManifestStory) => {
  const play = errors.filter(({ source }) => source === "play");
  return play.length === 0 ? null : play.map(({ message }) => message).join("; ");
};

/** `null` stands for "nobody checked", which is also a failed story's answer. */
function unstableFlag({ stability }: ManifestStory): boolean | null {
  return stability === "unstable" ? true : stability === "stable" ? false : null;
}

/**
 * Stores a group's PNGs as written. A file the store refuses is that story's failure, not the
 * run's: `putImages` can't say which one it was, so a refused group goes one at a time.
 */
async function storeGroup(
  project: Project,
  files: readonly { readonly story: string; readonly png: Uint8Array }[],
): Promise<{ hashes: Map<string, string>; refused: Map<string, string> }> {
  const hashes = new Map<string, string>();
  const refused = new Map<string, string>();
  try {
    const stored = await project.store.putImages(files.map(({ png }) => png));
    stored.forEach(({ hash }, i) => hashes.set(files[i]!.story, hash));
  } catch (error) {
    if (!(error instanceof ImageDecodeError)) throw error;
    for (const { story, png } of files) {
      try {
        hashes.set(story, (await project.store.putImage(png)).hash);
      } catch (inner) {
        if (!(inner instanceof ImageDecodeError)) throw inner;
        refused.set(story, inner.message);
      }
    }
  }
  return { hashes, refused };
}

/** Puts the capture's images in the store, and returns one row per story. */
async function storeCapture(project: Project, captureDir: string, manifest: Manifest): Promise<RecordedSnapshot[]> {
  const records: RecordedSnapshot[] = [];
  for (const group of chunks(manifest.stories, IMAGES_PER_GROUP)) {
    const failures = new Map<string, string>();
    const files: { story: string; png: Uint8Array }[] = [];
    for (const story of group) {
      if (story.status !== "ok" || story.file === null) {
        failures.set(story.id, describeErrors(story.errors));
        continue;
      }
      const checked = await regularFileInside(captureDir, story.file);
      if ("refused" in checked) failures.set(story.id, `The capture is unusable: ${checked.refused}`);
      else files.push({ story: story.id, png: await readFile(checked.file) });
    }
    const stored = await storeGroup(project, files);
    for (const [story, message] of stored.refused) failures.set(story, `The store refused its image: ${message}`);
    for (const story of group) {
      const imageHash = stored.hashes.get(story.id);
      const shared = { story: story.id, playError: playErrorOf(story) };
      records.push(
        imageHash !== undefined
          ? { ...shared, imageHash, unstable: unstableFlag(story) }
          : { ...shared, failure: failures.get(story.id)!, unstable: null },
      );
    }
  }
  return records;
}

async function mapConcurrently<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next;
        next += 1;
        results[at] = await work(items[at]!);
      }
    }),
  );
  return results;
}

/** Copies a stored image to a named file an agent can open, and returns its bytes with the path. */
async function exportImage(
  project: Project,
  directory: string,
  name: string,
  hash: string,
): Promise<{ file: string; bytes: Uint8Array }> {
  const bytes = await project.store.getImage(hash);
  if (bytes === null) throw new SelfieError("missing-image", `Image ${hash} is missing from the local store.`);
  const file = path.join(directory, name);
  await writeFile(file, bytes);
  return { file, bytes };
}

async function storyDirectory(runDir: string, story: string): Promise<string> {
  const directory = path.join(runDir, "stories", storyDirName(story));
  await mkdir(directory, { recursive: true });
  return directory;
}

/** Writes one difference's files, and computes a pixel diff if it is `changed`. */
async function exportDifference(project: Project, runDir: string, snapshot: ComparedSnapshot): Promise<Difference> {
  const { story, imageHash, goldenHash, decision } = snapshot;
  const directory = await storyDirectory(runDir, story);
  const current = imageHash === null ? null : await exportImage(project, directory, "current.png", imageHash);
  const golden = goldenHash === null ? null : await exportImage(project, directory, "golden.png", goldenHash);

  let pixelDiff: PixelDiff | null = null;
  let diff: string | null = null;
  if (snapshot.state === "changed" && current !== null && golden !== null) {
    const compared = await diffFiles(current.bytes, golden.bytes);
    pixelDiff = compared.diff;
    if (compared.png !== null) {
      diff = path.join(directory, "diff.png");
      await writeFile(diff, compared.png);
    }
  }
  return {
    story,
    state: snapshot.state as Difference["state"],
    decision,
    imageHash,
    goldenHash,
    current: current?.file ?? null,
    golden: golden?.file ?? null,
    diff,
    pixelDiff,
  };
}

/** Exports what's needed to act on the comparison: only `changed` snapshots get diff work. */
async function exportImages(project: Project, runDir: string, comparison: Comparison, captureDir: string, manifest: Manifest) {
  const { removed } = summarizeRun(comparison);
  const shown = [...comparison.snapshots.filter(({ state }) => isDecidable(state)), ...removed];
  const differences = await mapConcurrently(
    shown,
    Math.min(MAX_CONCURRENT_DIFFS, availableParallelism()),
    (snapshot) => exportDifference(project, runDir, snapshot),
  );

  // Unchanged stories can need a look too, so these get their images here.
  const exportCurrent = async ({ story, imageHash }: ComparedSnapshot) => {
    if (imageHash === null) return null;
    return (await exportImage(project, await storyDirectory(runDir, story), "current.png", imageHash)).file;
  };
  const playErrors = await Promise.all(
    comparison.snapshots
      .filter(({ playError }) => playError !== null)
      .map(async (snapshot) => ({
        story: snapshot.story,
        playError: snapshot.playError!,
        current: await exportCurrent(snapshot),
      })),
  );

  const repeatFiles = new Map(manifest.stories.map(({ id, repeatFile }) => [id, repeatFile]));
  const exportRepeat = async (story: string) => {
    const repeatFile = repeatFiles.get(story) ?? null;
    if (repeatFile === null) return null;
    const checked = await regularFileInside(captureDir, repeatFile);
    if ("refused" in checked) return null;
    const file = path.join(await storyDirectory(runDir, story), "repeat.png");
    await copyFile(checked.file, file);
    return file;
  };
  const unstable = await Promise.all(
    comparison.snapshots
      .filter(({ unstable: flag }) => flag === true)
      .map(async (snapshot) => ({
        story: snapshot.story,
        current: await exportCurrent(snapshot),
        repeat: await exportRepeat(snapshot.story),
      })),
  );
  return { differences, playErrors, unstable };
}

/** What a capture says about a filter, as a fact for the run. */
function storyFilterOf(patterns: readonly string[] | undefined, manifest: Manifest): StoryFilter | null {
  return patterns === undefined ? null : { patterns, unmatched: filterStories(manifest.stories, patterns).unmatched };
}

async function recordRun(
  project: Project,
  captureDir: string,
  manifest: Manifest,
  fields: {
    gitSha: string;
    settings: CaptureSettings;
    dirty: boolean;
    baselineSha: string | null;
    storyFilter: StoryFilter | null;
  },
) {
  const { snapshots } = project;
  const run = await snapshots.beginRun({
    gitSha: fields.gitSha,
    environment: fields.settings.environmentId,
    dirty: fields.dirty,
    baselineSha: fields.baselineSha,
    storyFilter: fields.storyFilter,
  });
  const records = await storeCapture(project, captureDir, manifest);
  await snapshots.recordSnapshots(run.id, records);
  await snapshots.finishRun(run.id, records.length);
  return run;
}

/**
 * Renders a built Storybook, records a run, and exports what differs from the baseline. A story's
 * failure is a fact in the result. Throws if the review couldn't run.
 */
export async function review(project: Project, options: ReviewOptions): Promise<ReviewResult> {
  const { repo } = project;
  const log = options.log ?? (() => {});
  const capture = options.capture ?? realCapture;
  const started = Date.now();
  const storybookDir = path.resolve(project.cwd, options.storybookDir);
  const captureDir = captureDirectory(project, randomUUID());
  try {
    // 1. Build. Whatever it writes is part of what this review describes, so it comes first.
    if (options.buildCommand !== undefined) {
      log(`Building: ${options.buildCommand}`);
      await runBuildCommand(options.buildCommand, project.cwd, options.signal);
    }

    // 2. Read where we are.
    const gitSha = await headSha(repo);
    if (gitSha === null) {
      throw new SelfieError("no-commits", "This repository has no commits yet, and a run is recorded against a Git SHA.");
    }
    const settings = await resolveCaptureSettings(repo, { native: options.native });
    const baseline = await findBaseline(project, settings.environmentId);
    const dirtyBefore = await dirtyPaths(repo);

    // 3. Capture.
    const captureStarted = Date.now();
    const manifest = await capture({
      storybookDir,
      outDir: captureDir,
      environment: settings.environment,
      stability: options.stability ?? false,
      log,
      ...(options.stories === undefined ? {} : { stories: [...options.stories] }),
      ...(settings.initScript === undefined ? {} : { initScript: settings.initScript }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const captured = Date.now();
    assertStoriesCaptured(manifest, storybookDir, options.stories);

    // 4. Check one commit still describes what rendered.
    const shaAfter = await headSha(repo);
    if (shaAfter !== gitSha) {
      throw new SelfieError("head-moved", `HEAD moved from ${gitSha} to ${shaAfter} during the render, so review again.`);
    }
    const dirty = [...new Set([...dirtyBefore, ...(await dirtyPaths(repo))])];

    // 5. Record.
    const run = await recordRun(project, captureDir, manifest, {
      gitSha,
      settings,
      dirty: dirty.length > 0,
      baselineSha: baseline.sha,
      storyFilter: storyFilterOf(options.stories, manifest),
    });
    const stored = Date.now();
    log(`Recorded run ${run.id}: ${manifest.stories.length} stories.`);

    // 6. Compare.
    const comparison = await project.snapshots.compareRun(run.id, baseline.sha);
    const compared = Date.now();

    // 7. Export, keep a cache of what was exported, and prune older runs.
    const runDir = runDirectory(project, run.id);
    await mkdir(runDir, { recursive: true });
    const { differences, playErrors, unstable } = await exportImages(project, runDir, comparison, captureDir, manifest);
    const diffed = Date.now();
    await writeReviewCache(project, run.id, {
      differences: differences.map(({ story, current, golden, diff, pixelDiff }) => ({
        story,
        current,
        golden,
        diff,
        pixelDiff,
      })),
      playErrors: playErrors.map(({ story, current }) => ({ story, current })),
      unstable,
    });
    await pruneOutput(project, run.id);

    return {
      comparison,
      dirtyPaths: dirty,
      baseline,
      stabilityChecked: options.stability ?? false,
      differences,
      playErrors,
      unstable,
      warnings: manifest.warnings,
      timings: {
        captureMs: captured - captureStarted,
        storeMs: stored - captured,
        compareMs: compared - stored,
        diffMs: diffed - compared,
        totalMs: Date.now() - started,
      },
    };
  } finally {
    await rm(captureDir, { recursive: true, force: true });
  }
}
