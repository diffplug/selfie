import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { defineEnvironment, environmentId, launchArgs, type RenderEnvironment } from "./environment.ts";
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
import { prepareRunner, runWorker, type WorkerOutcome } from "./runners.ts";
import { filterStories, readStoryIndex, RenderError, type StoryEntry } from "./storybook.ts";
import { CAPTURE_RECIPE } from "./worker/protocol.ts";

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_STORY_TIMEOUT_MS = 60_000;
const DEFAULT_SETTLE_MS = 500;
/** Browser launch and shutdown, on top of the worst case for the stories themselves. */
const RUN_OVERHEAD_MS = 90_000;
/**
 * The repeat settles this much longer, so a timer shows up instead of matching by luck: with
 * equal timing, unfrozen stories matched in every run measured. It sits near the half period
 * of common caret blinks (see render.rationale.md).
 */
const REPEAT_EXTRA_SETTLE_MS = 530;

const NATIVE_WARNING =
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
  /** How long to wait after the network and fonts, before the screenshot. Recorded in the manifest. */
  settleMs?: number;
  /** Runs before story code in every frame, after `window.__SELFIE_SNAPSHOT__` is set. Its hash is in the manifest. */
  initScript?: string;
  signal?: AbortSignal;
  /** Human progress. Defaults to stderr. */
  log?: (line: string) => void;
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
  const id = environmentId(environment);
  const { runner } = environment;

  const concurrency = options.concurrency ?? Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism());
  const storyTimeoutMs = options.storyTimeoutMs ?? DEFAULT_STORY_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RenderError(`concurrency must be a positive integer, got ${concurrency}.`);
  if (!Number.isInteger(storyTimeoutMs) || storyTimeoutMs < 1)
    throw new RenderError(`storyTimeoutMs must be a positive integer, got ${storyTimeoutMs}.`);
  if (!Number.isInteger(settleMs) || settleMs < 0)
    throw new RenderError(`settleMs must be a non-negative integer, got ${settleMs}.`);

  const warnings: string[] = [];
  if (runner.kind === "native") {
    warnings.push(NATIVE_WARNING);
    log(NATIVE_WARNING);
  }

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

  // Before clearing the output, so a runner that can't run doesn't cost the previous results.
  await prepareRunner(runner);

  const storiesDir = path.join(outDir, STORIES_DIR);
  const repeatDir = path.join(outDir, REPEAT_DIR);
  await Promise.all(
    [storiesDir, repeatDir, path.join(outDir, MANIFEST_FILE)].map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
  await mkdir(storiesDir, { recursive: true });

  const pass = (
    label: string,
    passDir: string,
    entries: StoryEntry[],
    passSettleMs: number,
  ): Promise<WorkerOutcome> => {
    let finished = 0;
    return runWorker({
      runner,
      buildDir,
      outDir: passDir,
      signal: options.signal,
      onStory: (result) => {
        finished += 1;
        log(`${label} ${finished}/${entries.length} ${result.status} ${result.id}`);
      },
      job: {
        stories: entries.map((story) => ({ id: story.id, file: storyFileName(story.id) })),
        launchArgs: launchArgs(environment),
        viewport: environment.viewport,
        scale: environment.scale,
        settleMs: passSettleMs,
        initScript: options.initScript ?? null,
        concurrency,
        storyTimeoutMs,
        runTimeoutMs: Math.ceil(entries.length / concurrency) * storyTimeoutMs + RUN_OVERHEAD_MS,
      },
    });
  };

  const manifest: Manifest = {
    schemaVersion: 1,
    environmentId: id,
    environment,
    recipe: CAPTURE_RECIPE,
    settleMs,
    runtime: null,
    initScriptSha256:
      options.initScript === undefined ? null : createHash("sha256").update(options.initScript).digest("hex"),
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

  const first = await pass("render", storiesDir, stories, settleMs);
  manifest.runtime = first.runtime;
  manifest.stories = stories.map((story) => toManifestStory(story, first.results.get(story.id), first.crash));
  if (first.crash !== null) warnings.push(`The worker stopped early: ${first.crash}`);
  // Written now too, so a failure during the repeat still leaves the first pass's results.
  await save();

  const passed = stories.filter((story) => first.results.get(story.id)?.status === "ok");
  if (options.stability && passed.length > 0) {
    await mkdir(repeatDir, { recursive: true });
    // A second worker rather than a second loop, so a cold start is part of what's tested.
    const second = await pass("repeat", repeatDir, passed, settleMs + REPEAT_EXTRA_SETTLE_MS);
    if (second.crash !== null) warnings.push(`The worker stopped early during the repeat: ${second.crash}`);
    manifest.stories = manifest.stories.map((story) =>
      withRepeat(story, second.results.get(story.id), second.crash),
    );
    await Promise.all(
      manifest.stories
        .filter((story) => story.repeatFile === null)
        .map((story) => rm(path.join(repeatDir, storyFileName(story.id)), { force: true })),
    );
    await save();
  }
  return manifest;
}
