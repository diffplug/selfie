import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import {
  render as realRender,
  filterStories,
  storybookHash,
  renderIdentity,
  type Manifest,
  type ManifestStory,
  type RenderOptions,
  type StoryError,
  unmatchedPatternWarning,
} from "selfie-render";
import {
  chunks,
  ImageDecodeError,
  mapConcurrently,
  type ComparedRender,
  type Comparison,
  type Decision,
  type RecordedRender,
  type RawImage,
  type RenderBatch,
  type BuiltStorybookFile,
  type StoryFilter,
} from "selfie-store";
import { resolveRenderSettings, resolveHunkMergeDistance, resolveStorybookDir, type RenderSettings } from "./config.ts";
import { diffToPng, type PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { dirtyPaths, headSha, resolveCommit, type BaselineSearch } from "./git.ts";
import { isBatchId, regularFileInside, storyDirName } from "./paths.ts";
import { encodePng } from "./png.ts";
import {
  branchGoldens,
  renderDirectory,
  compareAsReviewed,
  findBaseline,
  pruneOutput,
  requireBatch,
  batchDirectory,
  writeReviewCache,
  type Project,
} from "./project.ts";
import { isDecidable, summarizeBatch } from "./summary.ts";

/** Each group is read into memory whole. */
const IMAGES_PER_GROUP = 100;
const MAX_CONCURRENT_DIFFS = 6;

export interface RenderBatchOptions {
  /** Relative to the project's `cwd`. Defaults to the config's, and then to `storybook-static`. */
  readonly storybookDir?: string | undefined;
  /** The caller's own command, run in a shell. Its stdout goes to stderr. */
  readonly buildCommand?: string | undefined;
  /** Run the config's `buildCommand`, from the Git top level. Only ever because someone asked. */
  readonly buildFromConfig?: boolean | undefined;
  /** Story ID patterns. Defaults to every story. */
  readonly stories?: readonly string[] | undefined;
  readonly native?: boolean | undefined;
  /** Defaults to the renderer's. */
  readonly render?: typeof realRender | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Progress for people. Defaults to nothing. */
  readonly log?: ((line: string) => void) | undefined;
  /** Progress for a program, if this renders. */
  readonly onProgress?: RenderOptions["onProgress"] | undefined;
}

/** A batch to review, or else what to record one from if this built Storybook has none. */
export type ReviewOptions = ({ readonly batch: string } | (RenderBatchOptions & { readonly batch?: undefined })) & {
  /** A commit with goldens, or a finished batch. It changes this review alone: `accept` still checks the batch's own. */
  readonly baseline?: string | undefined;
};

/** What `--baseline` resolved to. */
export type GivenBaseline = { readonly sha: string; readonly batch?: undefined } | { readonly batch: string; readonly sha?: undefined };

export interface Difference {
  readonly story: string;
  readonly state: "changed" | "added" | "removed";
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
  /** Everything about the batch, as `summarizeBatch` reads it. */
  readonly comparison: Comparison;
  /** Modified, staged, and untracked paths while it rendered. Empty for a batch that was named. */
  readonly dirtyPaths: readonly string[];
  /** The batch's own: what `accept` checks. */
  readonly baseline: BaselineSearch;
  /** What this review compared with instead, if anything. */
  readonly given: GivenBaseline | null;
  /** With no baseline and nothing given, the nearest goldens on this branch, which it compared with. */
  readonly branchGoldens: string | null;
  /** The comparison accepting checks, which says what blocks. `comparison`, unless that's against the branch's goldens. */
  readonly reviewed: Comparison;
  /** How close hunks group here, in image pixels. */
  readonly hunkMergeDistance: number;
  /** Within the batch's filter. */
  readonly differences: readonly Difference[];
  readonly playErrors: readonly {
    readonly story: string;
    readonly playError: string;
    readonly current: string | null;
  }[];
  readonly warnings: readonly string[];
  readonly timings: {
    readonly renderMs: number;
    readonly storeMs: number;
    readonly compareMs: number;
    readonly diffMs: number;
    readonly totalMs: number;
  };
}

/** Builds, if someone asked to. Nothing else ever runs a shell. */
export async function buildIfAsked(command: string | undefined, cwd: string, signal: AbortSignal | undefined, log: (line: string) => void): Promise<void> {
  if (command === undefined) return;
  log(`Building: ${command}`);
  await runBuildCommand(command, cwd, signal);
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
function assertStoriesRendered(count: number, storybookDir: string, stories: readonly string[] | undefined) {
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
 * batch's: `putImages` can't say which one it was, so a refused group goes one at a time.
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

/** Puts the render's images in the store, and returns one row per story. */
async function storeRender(project: Project, renderDir: string, manifest: Manifest): Promise<RecordedRender[]> {
  const records: RecordedRender[] = [];
  for (const group of chunks(manifest.stories, IMAGES_PER_GROUP)) {
    const failures = new Map<string, string>();
    const files: { story: string; png: Uint8Array }[] = [];
    for (const story of group) {
      if (story.status !== "ok" || story.file === null) {
        failures.set(story.id, describeErrors(story.errors));
        continue;
      }
      const checked = await regularFileInside(renderDir, story.file);
      if ("refused" in checked) failures.set(story.id, `The render is unusable: ${checked.refused}`);
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

async function storyDirectory(batchDir: string, story: string): Promise<string> {
  const directory = path.join(batchDir, "stories", storyDirName(story));
  await mkdir(directory, { recursive: true });
  return directory;
}

/** Writes one difference's files, and computes a pixel diff if it is `changed`. */
async function exportDifference(project: Project, batchDir: string, render: ComparedRender): Promise<Difference> {
  const { story, imageHash, goldenHash, decision } = render;
  const directory = await storyDirectory(batchDir, story);
  const current = imageHash === null ? null : await exportImage(project, directory, "current.png", imageHash);
  const golden = goldenHash === null ? null : await exportImage(project, directory, "golden.png", goldenHash);

  let pixelDiff: PixelDiff | null = null;
  let diff: string | null = null;
  if (render.state === "changed" && current !== null && golden !== null) {
    const compared = await diffToPng(current.image, golden.image);
    pixelDiff = compared.diff;
    diff = path.join(directory, "diff.png");
    await writeFile(diff, compared.png);
  }
  return {
    story,
    state: render.state as Difference["state"],
    decision,
    imageHash,
    goldenHash,
    current: current?.file ?? null,
    golden: golden?.file ?? null,
    diff,
    pixelDiff,
  };
}

/** Exports what's needed to act on the comparison: only `changed` renders get diff work. */
async function exportImages(project: Project, batchDir: string, comparison: Comparison) {
  const { removed } = summarizeBatch(comparison);
  const shown = [...comparison.renders.filter(({ state }) => isDecidable(state)), ...removed];
  // Each of these holds whole images in memory.
  const limit = Math.min(MAX_CONCURRENT_DIFFS, availableParallelism());
  const differences = await mapConcurrently(shown, limit, (render) => exportDifference(project, batchDir, render));

  // An unchanged story with a play error needs a look too, so these get their images here.
  const playErrors = await mapConcurrently(
    comparison.renders.filter(({ playError }) => playError !== null),
    limit,
    async ({ story, playError, imageHash }) => ({
      story,
      playError: playError!,
      current:
        imageHash === null ? null : (await exportImage(project, await storyDirectory(batchDir, story), "current.png", imageHash)).file,
    }),
  );
  return { differences, playErrors };
}

/** What a render says about a filter, as a fact for the batch. */
function storyFilterOf(patterns: readonly string[] | undefined, stories: readonly string[]): StoryFilter | null {
  if (patterns === undefined) return null;
  return { patterns, unmatched: filterStories(stories.map((id) => ({ id })), patterns).unmatched };
}

/** What a review's later steps read, whether it rendered or found an earlier render. */
interface Recording {
  readonly reusedFromBatch: string | null;
  readonly storyIds: readonly string[];
  readonly warnings: readonly string[];
  readonly records: () => Promise<readonly RecordedRender[]>;
  /** Called with the finished batch, if a new one was recorded. */
  readonly finished: (batch: RenderBatch) => Promise<void>;
}

/** The project's own code, which the same built Storybook repeats. Anything else might not recur. */
const REPEATABLE_ERRORS: ReadonlySet<StoryError["source"]> = new Set(["play", "console", "page"]);

/** Why this render mustn't answer a later review, or null if it may. */
function whyNotReusable({ stories, warnings }: Manifest, { status }: RenderBatch): string | null {
  if (status !== "complete") return "a story failed";
  for (const { id, errors } of stories) {
    const error = errors.find(({ source }) => !REPEATABLE_ERRORS.has(source));
    if (error !== undefined) return `${id} had a ${error.source} error, which might not recur: ${error.message.split("\n")[0]}`;
  }
  return warnings[0] === undefined ? null : `the render warned: ${warnings[0]}`;
}

/** The earlier render of this exact built Storybook, if there's one, narrowed to the patterns. */
async function replay(
  project: Project,
  identity: string,
  patterns: readonly string[] | undefined,
  log: (line: string) => void,
): Promise<Recording | null> {
  const batchId = await project.renderKeys.find(identity);
  if (batchId === null || (await project.batches.getBatch(batchId))?.status !== "complete") return null;
  const { renders } = await project.batches.compareBatch(batchId, null, { includeUnchanged: true });
  const stories = renders.map((render) => ({ id: render.story, render }));
  const chosen = patterns === undefined ? stories : filterStories(stories, patterns).stories;
  const storyIds = chosen.map(({ id }) => id);
  return {
    reusedFromBatch: batchId,
    storyIds,
    warnings: (storyFilterOf(patterns, storyIds)?.unmatched ?? []).map(unmatchedPatternWarning),
    // A remembered batch is `complete`, so every row has an image.
    records: async () =>
      chosen.map(({ render: { story, imageHash, playError } }) => ({ story, imageHash: imageHash!, playError })),
    finished: async () =>
      log(`Reused the images of batch ${batchId}, since this exact built Storybook already rendered. selfie render renders again.`),
  };
}

/** Renders the built Storybook. Only a render of every story can answer a later review, so only it is remembered. */
/** What a render takes from a project's settings and a command's options. */
export function renderInput(
  { storybookDir, outDir, log }: { readonly storybookDir: string; readonly outDir: string; readonly log: (line: string) => void },
  settings: RenderSettings,
  options: Pick<RenderBatchOptions, "stories" | "signal" | "onProgress">,
): RenderOptions {
  return {
    storybookDir,
    outDir,
    environment: settings.environment,
    log,
    ...(options.stories === undefined ? {} : { stories: [...options.stories] }),
    ...(settings.initScript === undefined ? {} : { initScript: settings.initScript }),
    ...(settings.settleMs === undefined ? {} : { settleMs: settings.settleMs }),
    ...(settings.storyTimeoutMs === undefined ? {} : { storyTimeoutMs: settings.storyTimeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };
}

/** Whatever build was asked for, if one was: the config's from the Git top level, or a given command from here. */
export async function buildAsAsked(project: Project, settings: RenderSettings, options: Pick<RenderBatchOptions, "buildCommand" | "buildFromConfig" | "signal">, log: (line: string) => void): Promise<void> {
  if (options.buildFromConfig === true) {
    if (settings.buildCommand === undefined) throw new SelfieError("usage", "--build runs the config's buildCommand, and selfie.config.json doesn't have one.");
    await buildIfAsked(settings.buildCommand, project.repo.root, options.signal, log);
  } else {
    await buildIfAsked(options.buildCommand, project.cwd, options.signal, log);
  }
}

async function renderFresh(
  project: Project,
  renderDir: string,
  render: typeof realRender,
  { storybookDir, identity, settings, options, log }: {
    readonly storybookDir: string;
    readonly identity: string | null;
    readonly settings: RenderSettings;
    readonly options: RenderBatchOptions;
    readonly log: (line: string) => void;
  },
): Promise<Recording> {
  const manifest = await render(renderInput({ storybookDir, outDir: renderDir, log }, settings, options));
  return {
    reusedFromBatch: null,
    storyIds: manifest.stories.map(({ id }) => id),
    warnings: manifest.warnings,
    records: () => storeRender(project, renderDir, manifest),
    async finished(batch) {
      if (options.stories !== undefined) return;
      if (identity === null) {
        log("This render won't be reused: a native environment, or a built Storybook holding a symlink, can't be recognized.");
        return;
      }
      // A built Storybook that changed while it rendered has no identity that describes these images.
      const after = await renderIdentity({ storybookDir, environment: settings.environment, initScript: settings.initScript, settleMs: settings.settleMs });
      const whyNot = after === identity ? whyNotReusable(manifest, batch) : "the built Storybook changed while it rendered";
      await project.renderKeys.remember(identity, whyNot === null ? batch.id : null);
      if (whyNot !== null) log(`This render won't be reused: ${whyNot}.`);
    },
  };
}

/**
 * Says which build rendered a batch, and keeps that built Storybook so its stories can still be opened. A built Storybook
 * that changed while it rendered isn't what rendered these images, so nothing is said of it. The batch
 * is sound either way, so failing to keep a built Storybook only costs its stories' links.
 */
async function keepStorybook(project: Project, batch: RenderBatch, storybookDir: string, before: string | null, log: (line: string) => void): Promise<void> {
  if (before === null) return;
  try {
    const files: BuiltStorybookFile[] = [];
    const after = await storybookHash(storybookDir, async (path, bytes) => void files.push({ path, fileHash: await project.storybooks.putFile(bytes) }));
    if (after !== before) return;
    await project.storybooks.putStorybook(before, files);
    await project.storybooks.recordBatchStorybook(batch.id, before);
  } catch (error) {
    log(`This batch's Storybook wasn't kept: ${(error as Error).message}`);
  }
}

/** What a batch says about where it was recorded. */
interface BatchFacts {
  readonly gitSha: string;
  readonly settings: RenderSettings;
  readonly dirty: boolean;
  readonly baselineSha: string | null;
  readonly storyFilter: StoryFilter | null;
}

async function recordBatch(
  project: Project,
  recording: Recording,
  fields: BatchFacts,
): Promise<RenderBatch> {
  const { batches } = project;
  const batch = await batches.beginBatch({
    gitSha: fields.gitSha,
    environment: fields.settings.environmentId,
    scale: fields.settings.environment.scale,
    dirty: fields.dirty,
    baselineSha: fields.baselineSha,
    storyFilter: fields.storyFilter,
    reusedFromBatch: recording.reusedFromBatch,
  });
  const records = await recording.records();
  await batches.recordRenders(batch.id, records);
  return batches.finishBatch(batch.id, records.length);
}

/** What recording left, for `render` to report and `review` to go on from. */
export interface RenderBatchResult {
  readonly batch: RenderBatch;
  /** Modified, staged, and untracked paths while it rendered. */
  readonly dirtyPaths: readonly string[];
  readonly baseline: BaselineSearch;
  readonly warnings: readonly string[];
  readonly timings: { readonly renderMs: number; readonly storeMs: number; readonly totalMs: number };
}

/** The batch that already says all this about this built Storybook at this commit, so a review needs no new one. */
async function sameBatch(project: Project, renderedBy: string, fields: BatchFacts): Promise<RenderBatch | null> {
  const batches = await project.batches.batchesAt(fields.gitSha, fields.settings.environmentId);
  const same = batches.find(
    ({ id, reusedFromBatch, status, dirty, baselineSha, storyFilter }) =>
      (id === renderedBy || reusedFromBatch === renderedBy) &&
      status === "complete" &&
      dirty === fields.dirty &&
      baselineSha === fields.baselineSha &&
      JSON.stringify(storyFilter) === JSON.stringify(fields.storyFilter),
  );
  return same ?? null;
}

async function renderAndRecord(project: Project, options: RenderBatchOptions, { reuse }: { reuse: boolean }): Promise<RenderBatchResult> {
  const { repo } = project;
  const log = options.log ?? (() => {});
  const render = options.render ?? realRender;
  const started = Date.now();
  const renderDir = renderDirectory(project, randomUUID());
  try {
    // 1. Build. Whatever it writes is part of what this describes, so it comes first.
    // Before building, so a bad config doesn't cost a whole built Storybook to find out.
    const settings = await resolveRenderSettings(repo, { native: options.native });
    await buildAsAsked(project, settings, options, log);

    // 2. Read where we are.
    const gitSha = await headSha(repo);
    if (gitSha === null) {
      throw new SelfieError("no-commits", "This repository has no commits yet, and a batch is recorded against a Git SHA.");
    }
    const storybookDir = resolveStorybookDir(project.cwd, options.storybookDir, settings);
    const baseline = await findBaseline(project, settings.environmentId);
    const dirtyBefore = await dirtyPaths(repo);

    // 3. Render, unless asked to reuse and this exact built Storybook already rendered.
    const renderStarted = Date.now();
    const buildBefore = await storybookHash(storybookDir);
    const identity = await renderIdentity({ storybookDir, environment: settings.environment, initScript: settings.initScript, settleMs: settings.settleMs });
    const replayed = identity !== null && reuse ? await replay(project, identity, options.stories, log) : null;
    const recording = replayed ?? (await renderFresh(project, renderDir, render, { storybookDir, identity, settings, options, log }));
    const rendered = Date.now();
    assertStoriesRendered(recording.storyIds.length, storybookDir, options.stories);

    // 4. Check one commit still describes what rendered.
    const shaAfter = await headSha(repo);
    if (shaAfter !== gitSha) {
      throw new SelfieError("head-moved", `HEAD moved from ${gitSha} to ${shaAfter} during the render, so try again.`);
    }
    const dirty = [...new Set([...dirtyBefore, ...(await dirtyPaths(repo))])];

    // 5. Record, unless a batch already says all this.
    const fields = {
      gitSha,
      settings,
      dirty: dirty.length > 0,
      baselineSha: baseline.sha,
      storyFilter: storyFilterOf(options.stories, recording.storyIds),
    };
    const existing = recording.reusedFromBatch === null ? null : await sameBatch(project, recording.reusedFromBatch, fields);
    const batch = existing ?? (await recordBatch(project, recording, fields));
    const stored = Date.now();
    if (existing === null) {
      log(`Recorded batch ${batch.id}: ${recording.storyIds.length} stories.`);
      await recording.finished(batch);
      await project.storybooks.recordViewport(batch.environment, settings.environment.viewport);
      await keepStorybook(project, batch, storybookDir, buildBefore, log);
    } else {
      log(`Batch ${batch.id} already describes this built Storybook at this commit, so nothing new was recorded. selfie render renders again.`);
    }
    await project.notes.rememberBatch(batch.id);
    return {
      batch,
      dirtyPaths: dirty,
      baseline,
      warnings: recording.warnings,
      timings: { renderMs: rendered - renderStarted, storeMs: stored - rendered, totalMs: Date.now() - started },
    };
  } finally {
    await rm(renderDir, { recursive: true, force: true });
  }
}

/**
 * Always renders a built Storybook, and records a batch. A story's failure is a fact in the result.
 * Throws if it couldn't run.
 */
export function renderBatch(project: Project, options: RenderBatchOptions): Promise<RenderBatchResult> {
  return renderAndRecord(project, options, { reuse: false });
}

/** A review of a batch that's already recorded, which is what recording would have given it. */
async function namedBatch(project: Project, batchId: string): Promise<RenderBatchResult> {
  const batch = await requireBatch(project, batchId);
  return {
    batch,
    dirtyPaths: [],
    baseline: { sha: batch.baselineSha, reason: null, message: null, defaultBranch: null, mergeBase: null },
    warnings: (batch.storyFilter?.unmatched ?? []).map(unmatchedPatternWarning),
    timings: { renderMs: 0, storeMs: 0, totalMs: 0 },
  };
}

/** What `--baseline` means: a batch by its ID, or else a commit by anything Git calls one. */
async function resolveGiven(project: Project, given: string): Promise<GivenBaseline> {
  if (isBatchId(given)) return { batch: given };
  const sha = await resolveCommit(project.repo, given);
  if (sha === null) throw new SelfieError("unknown-baseline", `"${given}" is neither a batch ID nor a commit here.`);
  return { sha };
}

/**
 * Exports what differs from the baseline in a batch: one it's told to look at, or else the one
 * for this built Storybook, recording it only if there's none. A story's failure is a fact in the result.
 * Throws if the review couldn't run.
 */
export async function review(project: Project, options: ReviewOptions): Promise<ReviewResult> {
  const started = Date.now();
  const recorded =
    options.batch !== undefined ? await namedBatch(project, options.batch) : await renderAndRecord(project, options, { reuse: true });
  const { batch, baseline } = recorded;
  const given = options.baseline === undefined ? null : await resolveGiven(project, options.baseline);

  // 6. Compare.
  const comparing = Date.now();
  const onBranch = given === null ? await branchGoldens(project, batch) : null;
  const comparison =
    given?.batch !== undefined
      ? await project.batches.compareWithBatch(batch.id, given.batch)
      : await project.batches.compareBatch(batch.id, given?.sha ?? onBranch ?? batch.baselineSha);
  const reviewed = onBranch === null ? comparison : await project.batches.compareBatch(batch.id, batch.baselineSha);
  const compared = Date.now();

  // 7. Export, keep a cache of what was exported, and prune older batches. A given baseline answers
  // one question and changes nothing about the batch, so it has its own directory and no cache.
  const batchDir = batchDirectory(project, batch.id);
  const exportDir = given === null ? batchDir : path.join(batchDir, "against", (given.batch ?? given.sha)!);
  await mkdir(exportDir, { recursive: true });
  const { differences, playErrors } = await exportImages(project, exportDir, comparison);
  const diffed = Date.now();
  if (given === null) {
    await writeReviewCache(project, batch.id, {
      differences: differences.map(({ story, current, golden, diff, pixelDiff }) => ({ story, current, golden, diff, pixelDiff })),
      playErrors: playErrors.map(({ story, current }) => ({ story, current })),
    });
  }
  await pruneOutput(project, batch.id);

  return {
    comparison,
    dirtyPaths: recorded.dirtyPaths,
    baseline,
    given,
    branchGoldens: onBranch,
    reviewed,
    hunkMergeDistance: (await resolveHunkMergeDistance(project.repo)) * batch.scale,
    differences,
    playErrors,
    warnings: recorded.warnings,
    timings: {
      renderMs: recorded.timings.renderMs,
      storeMs: recorded.timings.storeMs,
      compareMs: compared - comparing,
      diffMs: diffed - compared,
      totalMs: Date.now() - started,
    },
  };
}

/**
 * An agent's answer to a note, on the newest batch if it doesn't say. Says whether the note's image is
 * still what the batch has, so a claimed fix that moved nothing shows at once.
 */
export async function replyToNote(project: Project, id: number, text: string, givenBatch: string | undefined): Promise<{ readonly note: number; readonly batchId: string | null; readonly imageChanged: boolean | null }> {
  const { notes } = project;
  const batchId = givenBatch ?? (await notes.latestBatch());
  if (givenBatch !== undefined) {
    await requireBatch(project, givenBatch);
    await notes.rememberBatch(givenBatch);
  }
  await notes.reply(id, text, batchId);
  const note = (await notes.list()).find((candidate) => candidate.id === id)!;
  if (batchId === null || note.imageHash === null) return { note: id, batchId, imageChanged: null };
  const { renders: compared } = await compareAsReviewed(project, batchId, { includeUnchanged: true });
  const now = compared.find(({ story }) => story === note.story)?.imageHash ?? null;
  return { note: id, batchId, imageChanged: now !== note.imageHash };
}
