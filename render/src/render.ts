import { access, mkdir, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { defineEnvironment, environmentId, launchArgs, type RenderEnvironment } from "./environment.ts";
import { initScriptHash } from "./identity.ts";
import {
  MANIFEST_FILE,
  STORIES_DIR,
  storyFileName,
  toManifestStory,
  totalsOf,
  writeManifest,
  type Manifest,
} from "./manifest.ts";
import { prepareRunner, runWorker } from "./runners.ts";
import { filterStories, readStoryIndex, RenderError, unmatchedPatternWarning } from "./storybook.ts";

const DEFAULT_MAX_CONCURRENCY = 6;
const DEFAULT_STORY_TIMEOUT_MS = 60_000;
const DEFAULT_SETTLE_MS = 100;
/** Browser launch and shutdown, on top of the worst case for the stories themselves. */
const RUN_OVERHEAD_MS = 90_000;
const NATIVE_WARNING =
  "Native runner: these images won't match other machines or the container. Use them for local experiments only.";

/**
 * How a render is going. `started` comes once, as the first story starts, so getting the runner and
 * the browser ready comes before it. `finished` comes as each story finishes, failed or not.
 */
export interface RenderProgressEvent {
  readonly event: "started" | "finished";
  /** Stories finished so far. */
  readonly finished: number;
  /** Stories this render has to do. */
  readonly total: number;
}

export interface RenderOptions {
  /** A built Storybook: the directory holding `index.json` and `iframe.html`. */
  storybookDir: string;
  /** Receives `manifest.json` and `stories/`. Those are replaced; nothing else is touched. */
  outDir: string;
  /** Defaults to the pinned container. */
  environment?: RenderEnvironment;
  /** Story ID patterns, where `*` matches any run of characters. Defaults to every story. */
  stories?: string[];
  /** Stories rendered at once. Defaults to the machine's CPUs, at most 6. */
  concurrency?: number;
  /** The bound on one story, from opening its context to its screenshot. */
  storyTimeoutMs?: number;
  /** How long to wait after the network and fonts, before the screenshot. Recorded in the manifest. */
  settleMs?: number;
  /** Runs before story code in every frame, after `window.__SELFIE_RENDER__` is set. Its hash is in the manifest. */
  initScript?: string;
  signal?: AbortSignal;
  /** Human progress. Defaults to stderr. */
  log?: (line: string) => void;
  /** Progress for a program. Nothing comes with no stories to render. */
  onProgress?: (progress: RenderProgressEvent) => void;
}

/**
 * Renders the stories and writes the PNGs and manifest. A story's failure lands in the
 * manifest. Throws a `RenderError` only when no story could be attempted, such as a bad
 * build directory or an unavailable Docker.
 */
export async function render(options: RenderOptions): Promise<Manifest> {
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
    warnings.push(...filtered.unmatched.map(unmatchedPatternWarning));
  }
  if (stories.length === 0) warnings.push("No stories were selected.");

  // Before clearing the output, so a runner that can't run doesn't cost the previous results.
  await prepareRunner(runner);

  const storiesDir = path.join(outDir, STORIES_DIR);
  await Promise.all(
    [storiesDir, path.join(outDir, MANIFEST_FILE)].map((target) => rm(target, { recursive: true, force: true })),
  );
  await mkdir(storiesDir, { recursive: true });

  const manifest: Manifest = {
    schemaVersion: 1,
    environmentId: id,
    environment,
    recipe: environment.recipe,
    settleMs,
    runtime: null,
    initScriptSha256: initScriptHash(options.initScript),
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

  let finished = 0;
  const outcome = await runWorker({
    runner,
    buildDir,
    outDir: storiesDir,
    signal: options.signal,
    onStarted: () => options.onProgress?.({ event: "started", finished, total: stories.length }),
    onStory: (result) => {
      finished += 1;
      log(`render ${finished}/${stories.length} ${result.status} ${result.id}`);
      options.onProgress?.({ event: "finished", finished, total: stories.length });
    },
    job: {
      stories: stories.map((story) => ({ id: story.id, file: storyFileName(story.id) })),
      launchArgs: launchArgs(environment),
      viewport: environment.viewport,
      scale: environment.scale,
      recipe: environment.recipe,
      settleMs,
      initScript: options.initScript ?? null,
      concurrency,
      storyTimeoutMs,
      runTimeoutMs: Math.ceil(stories.length / concurrency) * storyTimeoutMs + RUN_OVERHEAD_MS,
    },
  });
  manifest.runtime = outcome.runtime;
  manifest.stories = stories.map((story) => toManifestStory(story, outcome.results.get(story.id), outcome.crash));
  if (outcome.crash !== null) warnings.push(`The worker stopped early: ${outcome.crash}`);
  await save();
  return manifest;
}
