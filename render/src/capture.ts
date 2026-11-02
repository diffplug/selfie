import { createHash } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import {
  currentNativeRunner,
  defineEnvironment,
  environmentId,
  HOUSEKEEPING_FLAGS,
  validateEnvironment,
  type RenderEnvironment,
} from "./environment.ts";
import {
  MANIFEST_FILE,
  REPEAT_DIR,
  STORIES_DIR,
  storyFileName,
  toManifestStory,
  totalsOf,
  withRepeat,
  writeManifest,
  type Manifest,
} from "./manifest.ts";
import { ensureImage, runWorker, type WorkerRun } from "./runners.ts";
import { filterStories, readStoryIndex, RenderError, type StoryEntry } from "./storybook.ts";
import { CAPTURE_RECIPE, SNAPSHOT_GLOBAL, type WorkerStoryResult } from "./worker/protocol.ts";

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_STORY_TIMEOUT_MS = 60_000;
/** Browser launch and shutdown, on top of the worst case for the stories themselves. */
const RUN_OVERHEAD_MS = 90_000;
const REPEAT_WORK_DIR = ".repeat-work";
/**
 * The repeat settles this much longer, so a timer shows up instead of matching by luck: with
 * equal timing, unfrozen stories matched in every run measured. It sits near the half period
 * of common caret blinks (see render.rationale.md).
 */
const REPEAT_EXTRA_SETTLE_MS = 530;

export const NATIVE_WARNING =
  "Native runner: these images won't match other machines or the container. Use them for local experiments only.";

export interface CaptureOptions {
  /** A built Storybook: the directory holding `index.json` and `iframe.html`. */
  storybookDir: string;
  /** Receives `manifest.json`, `stories/`, and `repeat/`. Those are replaced; nothing else is touched. */
  outDir: string;
  /** Defaults to the pinned container. */
  environment?: RenderEnvironment;
  /** Story ID patterns, where `*` matches any run of characters. Defaults to every story. */
  stories?: string[];
  /** Render every story a second time, settling longer, and flag those whose PNG differs. */
  stability?: boolean;
  /** Stories rendered at once. Defaults to the machine's CPUs, at most 4. */
  concurrency?: number;
  /** The bound on one story, from opening its context to its screenshot. */
  storyTimeoutMs?: number;
  /** Runs before story code in every frame, after `window.__SELFIE_SNAPSHOT__` is set. */
  initScript?: string;
  /** Added to every document before story code runs. */
  initCss?: string;
  signal?: AbortSignal;
  /** Human progress. Defaults to stderr, so stdout stays machine readable. */
  log?: (line: string) => void;
}

function sha256OrNull(text: string | undefined): string | null {
  return text === undefined ? null : createHash("sha256").update(text).digest("hex");
}

/**
 * Renders the stories and writes the PNGs and manifest. A story's failure lands in the
 * manifest. Throws a `RenderError` only when no story could be attempted, such as a bad
 * build directory or an unavailable Docker.
 */
export async function capture(options: CaptureOptions): Promise<Manifest> {
  const started = Date.now();
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const environment = options.environment ?? defineEnvironment();
  validateEnvironment(environment);
  const id = environmentId(environment);

  const warnings: string[] = [];
  if (environment.runner.kind === "native") {
    const here = currentNativeRunner();
    const { os, osRelease, arch } = environment.runner;
    if (os !== here.os || osRelease !== here.osRelease || arch !== here.arch) {
      throw new RenderError(
        `This native environment records ${os} ${osRelease} ${arch}, but this machine is ${here.os} ${here.osRelease} ${here.arch}.`,
      );
    }
    warnings.push(NATIVE_WARNING);
    log(NATIVE_WARNING);
  }

  const concurrency = options.concurrency ?? Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism());
  const storyTimeoutMs = options.storyTimeoutMs ?? DEFAULT_STORY_TIMEOUT_MS;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RenderError(`concurrency must be a positive integer, got ${concurrency}.`);
  if (!Number.isInteger(storyTimeoutMs) || storyTimeoutMs < 1)
    throw new RenderError(`storyTimeoutMs must be a positive integer, got ${storyTimeoutMs}.`);

  const buildDir = path.resolve(options.storybookDir);
  const outDir = path.resolve(options.outDir);
  let stories = await readStoryIndex(buildDir);
  await access(path.join(buildDir, "iframe.html")).catch(() => {
    throw new RenderError(`${buildDir} has no iframe.html, so it isn't a built Storybook.`);
  });
  if (options.stories) {
    const filtered = filterStories(stories, options.stories);
    stories = filtered.stories;
    for (const pattern of filtered.unmatched) warnings.push(`Story pattern "${pattern}" matched nothing.`);
  }
  if (stories.length === 0) warnings.push("No stories were selected.");

  // Before clearing the output, so an unavailable Docker doesn't cost the previous results.
  if (stories.length > 0 && environment.runner.kind === "container") await ensureImage(environment.runner);

  const storiesDir = path.join(outDir, STORIES_DIR);
  const repeatDir = path.join(outDir, REPEAT_DIR);
  const repeatWorkDir = path.join(outDir, REPEAT_WORK_DIR);
  await Promise.all(
    [storiesDir, repeatDir, repeatWorkDir, path.join(outDir, MANIFEST_FILE)].map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
  await mkdir(storiesDir, { recursive: true });

  const launchArgs = [...environment.browserFlags, ...HOUSEKEEPING_FLAGS];
  const pass = (
    label: string,
    passDir: string,
    entries: StoryEntry[],
    settleMs: number,
  ): ReturnType<typeof runWorker> => {
    let finished = 0;
    const run: WorkerRun = {
      environment,
      buildDir,
      outDir: passDir,
      runLabel: outDir,
      signal: options.signal,
      onStory: (result: WorkerStoryResult) => {
        finished += 1;
        log(`${label} ${finished}/${entries.length} ${result.status} ${result.id}`);
      },
      job: {
        stories: entries.map((story) => ({ id: story.id, file: storyFileName(story.id) })),
        launchArgs,
        viewport: environment.viewport,
        scale: environment.scale,
        settleMs,
        initScript: options.initScript ?? null,
        initCss: options.initCss ?? null,
        concurrency,
        storyTimeoutMs,
        runTimeoutMs: Math.ceil(entries.length / concurrency) * storyTimeoutMs + RUN_OVERHEAD_MS,
      },
    };
    return runWorker(run);
  };

  const manifest: Manifest = {
    schemaVersion: 1,
    environmentId: id,
    environment,
    recipe: CAPTURE_RECIPE,
    runtime: null,
    launchArgs,
    init: {
      global: SNAPSHOT_GLOBAL,
      scriptSha256: sha256OrNull(options.initScript),
      cssSha256: sha256OrNull(options.initCss),
    },
    stabilityChecked: false,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    warnings,
    totals: totalsOf([]),
    stories: [],
  };
  const save = async () => {
    manifest.totals = totalsOf(manifest.stories);
    manifest.durationMs = Date.now() - started;
    await writeManifest(outDir, manifest);
  };

  if (stories.length === 0) {
    await save();
    return manifest;
  }

  const first = await pass("render", storiesDir, stories, environment.settleMs);
  manifest.runtime = first.runtime;
  manifest.stories = stories.map((story) => toManifestStory(story, first.results.get(story.id), first.crash));
  if (first.crash !== null) warnings.push(`The worker stopped early: ${first.crash}`);
  // Written now too, so a failure during the repeat still leaves the first pass's results.
  await save();

  if (options.stability) {
    const passed = stories.filter((story) => first.results.get(story.id)?.status === "ok");
    await mkdir(repeatWorkDir, { recursive: true });
    // A second worker rather than a second loop, so a cold start is part of what's tested.
    const second =
      passed.length > 0
        ? await pass("repeat", repeatWorkDir, passed, environment.settleMs + REPEAT_EXTRA_SETTLE_MS)
        : null;
    if (second?.crash) warnings.push(`The worker stopped early during the repeat: ${second.crash}`);
    manifest.stories = manifest.stories.map((story) =>
      withRepeat(story, second?.results.get(story.id), second?.crash ?? null),
    );
    manifest.stabilityChecked = true;
    for (const story of manifest.stories) {
      if (story.repeatFile !== null) {
        await mkdir(repeatDir, { recursive: true });
        await rename(path.join(repeatWorkDir, storyFileName(story.id)), path.join(outDir, story.repeatFile));
      }
    }
    await rm(repeatWorkDir, { recursive: true, force: true });
    await save();
  }
  return manifest;
}
