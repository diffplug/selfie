import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import {
  capture as realCapture,
  filterStories,
  buildHash,
  renderIdentity,
  type Manifest,
  type ManifestStory,
  type StoryError,
  unmatchedPatternWarning,
} from "selfie-render";
import {
  chunks,
  ImageDecodeError,
  mapConcurrently,
  type ComparedSnapshot,
  type Comparison,
  type Decision,
  type RecordedSnapshot,
  type RawImage,
  type Run,
  type StorybookBuildFile,
  type StoryFilter,
} from "selfie-store";
import { resolveCaptureSettings, resolveRegionMergeDistance, resolveStorybookDir, type CaptureSettings } from "./config.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { dirtyPaths, headSha, resolveCommit, type BaselineSearch } from "./git.ts";
import { isRunId, regularFileInside, storyDirName } from "./paths.ts";
import { encodePng } from "./png.ts";
import {
  branchGoldens,
  captureDirectory,
  compareAsReviewed,
  findBaseline,
  pruneOutput,
  requireRun,
  runDirectory,
  writeReviewCache,
  type Project,
} from "./project.ts";
import { isDecidable, summarizeRun } from "./summary.ts";

/** Each group is read into memory whole. */
const IMAGES_PER_GROUP = 100;
const MAX_CONCURRENT_DIFFS = 6;

export interface RecordOptions {
  /** Relative to the project's `cwd`. Defaults to the config's, and then to `storybook-static`. */
  readonly storybookDir?: string | undefined;
  /** The caller's own command, run in a shell. Its stdout goes to stderr. */
  readonly buildCommand?: string | undefined;
  /** Story ID patterns. Defaults to every story. */
  readonly stories?: readonly string[] | undefined;
  readonly native?: boolean | undefined;
  /** Defaults to the renderer's. */
  readonly capture?: typeof realCapture | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Progress for people. Defaults to nothing. */
  readonly log?: ((line: string) => void) | undefined;
}

/** A run to review, or else what to record one from if this build has none. */
export type ReviewOptions = ({ readonly run: string } | (RecordOptions & { readonly run?: undefined })) & {
  /** A commit with goldens, or a finished run. It changes this review alone: `accept` still checks the run's own. */
  readonly baseline?: string | undefined;
};

/** What `--baseline` resolved to. */
export type GivenBaseline = { readonly sha: string; readonly run?: undefined } | { readonly run: string; readonly sha?: undefined };

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
  /** Modified, staged, and untracked paths while it rendered. Empty for a run that was named. */
  readonly dirtyPaths: readonly string[];
  /** The run's own: what `accept` checks. */
  readonly baseline: BaselineSearch;
  /** What this review compared with instead, if anything. */
  readonly given: GivenBaseline | null;
  /** With no baseline and nothing given, the nearest goldens on this branch, which it compared with. */
  readonly branchGoldens: string | null;
  /** The comparison accepting checks, which says what blocks. `comparison`, unless that's against the branch's goldens. */
  readonly reviewed: Comparison;
  /** How close regions group here, in image pixels. */
  readonly regionMergeDistance: number;
  /** Within the run's filter. */
  readonly differences: readonly Difference[];
  readonly playErrors: readonly {
    readonly story: string;
    readonly playError: string;
    readonly current: string | null;
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
function assertStoriesCaptured(count: number, storybookDir: string, stories: readonly string[] | undefined) {
  if (count > 0) return;
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
          ? { ...shared, imageHash }
          : { ...shared, failure: failures.get(story.id)! },
      );
    }
  }
  return records;
}

/** Writes a stored image as a PNG an agent can open, whatever it's stored as, and returns its pixels with the path. */
async function exportImage(
  project: Project,
  directory: string,
  name: string,
  hash: string,
): Promise<{ file: string; image: RawImage }> {
  const image = await project.store.getPixels(hash);
  if (image === null) throw new SelfieError("missing-image", `Image ${hash} is missing from the local store.`);
  const file = path.join(directory, name);
  await writeFile(file, await encodePng(image));
  return { file, image };
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
    const compared = await diffToPng(current.image, golden.image);
    pixelDiff = compared.diff;
    diff = path.join(directory, "diff.png");
    await writeFile(diff, compared.png);
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
async function exportImages(project: Project, runDir: string, comparison: Comparison) {
  const { removed } = summarizeRun(comparison);
  const shown = [...comparison.snapshots.filter(({ state }) => isDecidable(state)), ...removed];
  // Each of these holds whole images in memory.
  const limit = Math.min(MAX_CONCURRENT_DIFFS, availableParallelism());
  const differences = await mapConcurrently(shown, limit, (snapshot) => exportDifference(project, runDir, snapshot));

  // An unchanged story with a play error needs a look too, so these get their images here.
  const playErrors = await mapConcurrently(
    comparison.snapshots.filter(({ playError }) => playError !== null),
    limit,
    async ({ story, playError, imageHash }) => ({
      story,
      playError: playError!,
      current:
        imageHash === null ? null : (await exportImage(project, await storyDirectory(runDir, story), "current.png", imageHash)).file,
    }),
  );
  return { differences, playErrors };
}

/** What a capture says about a filter, as a fact for the run. */
function storyFilterOf(patterns: readonly string[] | undefined, stories: readonly string[]): StoryFilter | null {
  if (patterns === undefined) return null;
  return { patterns, unmatched: filterStories(stories.map((id) => ({ id })), patterns).unmatched };
}

/** What a review's later steps read, whether it rendered or found an earlier render. */
interface Recording {
  readonly reusedFromRun: string | null;
  readonly storyIds: readonly string[];
  readonly warnings: readonly string[];
  readonly records: () => Promise<readonly RecordedSnapshot[]>;
  /** Called with the finished run, if a new one was recorded. */
  readonly finished: (run: Run) => Promise<void>;
}

/** The project's own code, which the same build repeats. Anything else might not recur. */
const REPEATABLE_ERRORS: ReadonlySet<StoryError["source"]> = new Set(["play", "console", "page"]);

/** Why this render mustn't answer a later review, or null if it may. */
function whyNotReusable({ stories, warnings }: Manifest, { status }: Run): string | null {
  if (status !== "complete") return "a story failed";
  for (const { id, errors } of stories) {
    const error = errors.find(({ source }) => !REPEATABLE_ERRORS.has(source));
    if (error !== undefined) return `${id} had a ${error.source} error, which might not recur: ${error.message.split("\n")[0]}`;
  }
  return warnings[0] === undefined ? null : `the capture warned: ${warnings[0]}`;
}

/** The earlier render of this exact build, if there's one, narrowed to the patterns. */
async function replay(
  project: Project,
  identity: string,
  patterns: readonly string[] | undefined,
  log: (line: string) => void,
): Promise<Recording | null> {
  const runId = await project.renders.find(identity);
  if (runId === null || (await project.snapshots.getRun(runId))?.status !== "complete") return null;
  const { snapshots } = await project.snapshots.compareRun(runId, null, { includeUnchanged: true });
  const stories = snapshots.map((snapshot) => ({ id: snapshot.story, snapshot }));
  const chosen = patterns === undefined ? stories : filterStories(stories, patterns).stories;
  const storyIds = chosen.map(({ id }) => id);
  return {
    reusedFromRun: runId,
    storyIds,
    warnings: (storyFilterOf(patterns, storyIds)?.unmatched ?? []).map(unmatchedPatternWarning),
    // A remembered run is `complete`, so every row has an image.
    records: async () =>
      chosen.map(({ snapshot: { story, imageHash, playError } }) => ({ story, imageHash: imageHash!, playError })),
    finished: async () =>
      log(`Reused the images of run ${runId}, since this exact build already rendered. selfie record renders again.`),
  };
}

/** Captures the build. Only a render of every story can answer a later review, so only it is remembered. */
async function renderFresh(
  project: Project,
  captureDir: string,
  capture: typeof realCapture,
  { storybookDir, identity, settings, options, log }: {
    readonly storybookDir: string;
    readonly identity: string | null;
    readonly settings: CaptureSettings;
    readonly options: RecordOptions;
    readonly log: (line: string) => void;
  },
): Promise<Recording> {
  const manifest = await capture({
    storybookDir,
    outDir: captureDir,
    environment: settings.environment,
    log,
    ...(options.stories === undefined ? {} : { stories: [...options.stories] }),
    ...(settings.initScript === undefined ? {} : { initScript: settings.initScript }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return {
    reusedFromRun: null,
    storyIds: manifest.stories.map(({ id }) => id),
    warnings: manifest.warnings,
    records: () => storeCapture(project, captureDir, manifest),
    async finished(run) {
      if (options.stories !== undefined) return;
      if (identity === null) {
        log("This render won't be reused: a native environment, or a build holding a symlink, can't be recognized.");
        return;
      }
      // A build that changed while it rendered has no identity that describes these images.
      const after = await renderIdentity({ storybookDir, environment: settings.environment, initScript: settings.initScript });
      const whyNot = after === identity ? whyNotReusable(manifest, run) : "the build changed while it rendered";
      await project.renders.remember(identity, whyNot === null ? run.id : null);
      if (whyNot !== null) log(`This render won't be reused: ${whyNot}.`);
    },
  };
}

/**
 * Says which build rendered a run, and keeps that build so its stories can still be opened. A build
 * that changed while it rendered isn't what rendered these images, so nothing is said of it. The run
 * is sound either way, so failing to keep a build only costs its stories' links.
 */
async function keepBuild(project: Project, run: Run, storybookDir: string, before: string | null, log: (line: string) => void): Promise<void> {
  if (before === null) return;
  try {
    const files: StorybookBuildFile[] = [];
    const after = await buildHash(storybookDir, async (path, bytes) => void files.push({ path, fileHash: await project.builds.putFile(bytes) }));
    if (after !== before) return;
    await project.builds.putBuild(before, files);
    await project.builds.recordRunBuild(run.id, before);
  } catch (error) {
    log(`This run's Storybook wasn't kept: ${(error as Error).message}`);
  }
}

/** What a run says about where it was recorded. */
interface RunFacts {
  readonly gitSha: string;
  readonly settings: CaptureSettings;
  readonly dirty: boolean;
  readonly baselineSha: string | null;
  readonly storyFilter: StoryFilter | null;
}

async function recordRun(
  project: Project,
  recording: Recording,
  fields: RunFacts,
): Promise<Run> {
  const { snapshots } = project;
  const run = await snapshots.beginRun({
    gitSha: fields.gitSha,
    environment: fields.settings.environmentId,
    scale: fields.settings.environment.scale,
    dirty: fields.dirty,
    baselineSha: fields.baselineSha,
    storyFilter: fields.storyFilter,
    reusedFromRun: recording.reusedFromRun,
  });
  const records = await recording.records();
  await snapshots.recordSnapshots(run.id, records);
  return snapshots.finishRun(run.id, records.length);
}

/** What recording left, for `record` to report and `review` to go on from. */
export interface RecordResult {
  readonly run: Run;
  /** Modified, staged, and untracked paths while it rendered. */
  readonly dirtyPaths: readonly string[];
  readonly baseline: BaselineSearch;
  readonly warnings: readonly string[];
  readonly timings: { readonly captureMs: number; readonly storeMs: number; readonly totalMs: number };
}

/** The run that already says all this about this build at this commit, so a review needs no new one. */
async function sameRun(project: Project, renderedBy: string, fields: RunFacts): Promise<Run | null> {
  const runs = await project.snapshots.runsAt(fields.gitSha, fields.settings.environmentId);
  const same = runs.find(
    ({ id, reusedFromRun, status, dirty, baselineSha, storyFilter }) =>
      (id === renderedBy || reusedFromRun === renderedBy) &&
      status === "complete" &&
      dirty === fields.dirty &&
      baselineSha === fields.baselineSha &&
      JSON.stringify(storyFilter) === JSON.stringify(fields.storyFilter),
  );
  return same ?? null;
}

async function recordBuild(project: Project, options: RecordOptions, { reuse }: { reuse: boolean }): Promise<RecordResult> {
  const { repo } = project;
  const log = options.log ?? (() => {});
  const capture = options.capture ?? realCapture;
  const started = Date.now();
  const captureDir = captureDirectory(project, randomUUID());
  try {
    // 1. Build. Whatever it writes is part of what this describes, so it comes first.
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
    const storybookDir = resolveStorybookDir(project.cwd, options.storybookDir, settings);
    const baseline = await findBaseline(project, settings.environmentId);
    const dirtyBefore = await dirtyPaths(repo);

    // 3. Capture, unless asked to reuse and this exact build already rendered.
    const captureStarted = Date.now();
    const buildBefore = await buildHash(storybookDir);
    const identity = await renderIdentity({ storybookDir, environment: settings.environment, initScript: settings.initScript });
    const replayed = identity !== null && reuse ? await replay(project, identity, options.stories, log) : null;
    const recording = replayed ?? (await renderFresh(project, captureDir, capture, { storybookDir, identity, settings, options, log }));
    const captured = Date.now();
    assertStoriesCaptured(recording.storyIds.length, storybookDir, options.stories);

    // 4. Check one commit still describes what rendered.
    const shaAfter = await headSha(repo);
    if (shaAfter !== gitSha) {
      throw new SelfieError("head-moved", `HEAD moved from ${gitSha} to ${shaAfter} during the render, so try again.`);
    }
    const dirty = [...new Set([...dirtyBefore, ...(await dirtyPaths(repo))])];

    // 5. Record, unless a run already says all this.
    const fields = {
      gitSha,
      settings,
      dirty: dirty.length > 0,
      baselineSha: baseline.sha,
      storyFilter: storyFilterOf(options.stories, recording.storyIds),
    };
    const existing = recording.reusedFromRun === null ? null : await sameRun(project, recording.reusedFromRun, fields);
    const run = existing ?? (await recordRun(project, recording, fields));
    const stored = Date.now();
    if (existing === null) {
      log(`Recorded run ${run.id}: ${recording.storyIds.length} stories.`);
      await recording.finished(run);
      await keepBuild(project, run, storybookDir, buildBefore, log);
    } else {
      log(`Run ${run.id} already describes this build at this commit, so nothing new was recorded. selfie record renders again.`);
    }
    await project.notes.rememberRun(run.id);
    return {
      run,
      dirtyPaths: dirty,
      baseline,
      warnings: recording.warnings,
      timings: { captureMs: captured - captureStarted, storeMs: stored - captured, totalMs: Date.now() - started },
    };
  } finally {
    await rm(captureDir, { recursive: true, force: true });
  }
}

/**
 * Always renders a built Storybook, and records a run. A story's failure is a fact in the result.
 * Throws if it couldn't run.
 */
export function record(project: Project, options: RecordOptions): Promise<RecordResult> {
  return recordBuild(project, options, { reuse: false });
}

/** A review of a run that's already recorded, which is what recording would have given it. */
async function namedRun(project: Project, runId: string): Promise<RecordResult> {
  const run = await requireRun(project, runId);
  return {
    run,
    dirtyPaths: [],
    baseline: { sha: run.baselineSha, reason: null, message: null, defaultBranch: null, mergeBase: null },
    warnings: (run.storyFilter?.unmatched ?? []).map(unmatchedPatternWarning),
    timings: { captureMs: 0, storeMs: 0, totalMs: 0 },
  };
}

/** What `--baseline` means: a run by its ID, or else a commit by anything Git calls one. */
async function resolveGiven(project: Project, given: string): Promise<GivenBaseline> {
  if (isRunId(given)) return { run: given };
  const sha = await resolveCommit(project.repo, given);
  if (sha === null) throw new SelfieError("unknown-baseline", `"${given}" is neither a run ID nor a commit here.`);
  return { sha };
}

/**
 * Exports what differs from the baseline in a run: one it's told to look at, or else the one
 * for this build, recording it only if there's none. A story's failure is a fact in the result.
 * Throws if the review couldn't run.
 */
export async function review(project: Project, options: ReviewOptions): Promise<ReviewResult> {
  const started = Date.now();
  const recorded =
    options.run !== undefined ? await namedRun(project, options.run) : await recordBuild(project, options, { reuse: true });
  const { run, baseline } = recorded;
  const given = options.baseline === undefined ? null : await resolveGiven(project, options.baseline);

  // 6. Compare.
  const comparing = Date.now();
  const onBranch = given === null ? await branchGoldens(project, run) : null;
  const comparison =
    given?.run !== undefined
      ? await project.snapshots.compareWithRun(run.id, given.run)
      : await project.snapshots.compareRun(run.id, given?.sha ?? onBranch ?? run.baselineSha);
  const reviewed = onBranch === null ? comparison : await project.snapshots.compareRun(run.id, run.baselineSha);
  const compared = Date.now();

  // 7. Export, keep a cache of what was exported, and prune older runs. A given baseline answers
  // one question and changes nothing about the run, so it has its own directory and no cache.
  const runDir = runDirectory(project, run.id);
  const exportDir = given === null ? runDir : path.join(runDir, "against", (given.run ?? given.sha)!);
  await mkdir(exportDir, { recursive: true });
  const { differences, playErrors } = await exportImages(project, exportDir, comparison);
  const diffed = Date.now();
  if (given === null) {
    await writeReviewCache(project, run.id, {
      differences: differences.map(({ story, current, golden, diff, pixelDiff }) => ({ story, current, golden, diff, pixelDiff })),
      playErrors: playErrors.map(({ story, current }) => ({ story, current })),
    });
  }
  await pruneOutput(project, run.id);

  return {
    comparison,
    dirtyPaths: recorded.dirtyPaths,
    baseline,
    given,
    branchGoldens: onBranch,
    reviewed,
    regionMergeDistance: (await resolveRegionMergeDistance(project.repo)) * run.scale,
    differences,
    playErrors,
    warnings: recorded.warnings,
    timings: {
      captureMs: recorded.timings.captureMs,
      storeMs: recorded.timings.storeMs,
      compareMs: compared - comparing,
      diffMs: diffed - compared,
      totalMs: Date.now() - started,
    },
  };
}

/**
 * An agent's answer to a note, on the newest run if it doesn't say. Says whether the note's image is
 * still what the run has, so a claimed fix that moved nothing shows at once.
 */
export async function replyToNote(project: Project, id: number, text: string, givenRun: string | undefined): Promise<{ readonly note: number; readonly runId: string | null; readonly imageChanged: boolean | null }> {
  const { notes } = project;
  const runId = givenRun ?? (await notes.latestRun());
  if (givenRun !== undefined) {
    await requireRun(project, givenRun);
    await notes.rememberRun(givenRun);
  }
  await notes.reply(id, text, runId);
  const note = (await notes.list()).find((candidate) => candidate.id === id)!;
  if (runId === null || note.imageHash === null) return { note: id, runId, imageChanged: null };
  const { snapshots: compared } = await compareAsReviewed(project, runId, { includeUnchanged: true });
  const now = compared.find(({ story }) => story === note.story)?.imageHash ?? null;
  return { note: id, runId, imageChanged: now !== note.imageHash };
}
