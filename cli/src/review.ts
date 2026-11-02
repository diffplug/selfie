import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { filterStories, type Manifest, type ManifestStory, type RenderEnvironment, type StoryError } from "selfie-render";
import {
  decodeImage,
  ImageDecodeError,
  type ComparedSnapshot,
  type Decision,
  type RecordedSnapshot,
  type RunStatus,
} from "selfie-store";
import { resolveCaptureSettings } from "./config.ts";
import { diffImages, type PixelDiff } from "./diff.ts";
import { dirtyPaths, findBaseline, readHead, type BaselineResult } from "./git.ts";
import { CliError, EXIT_NEEDS_ATTENTION, EXIT_OK, printJson, type Context } from "./output.ts";
import { regularFileInside, storyDirName } from "./paths.ts";
import { encodePng } from "./png.ts";
import {
  captureDirectory,
  openProject,
  pruneOutput,
  runDirectory,
  writeRunRecord,
  type Project,
} from "./project.ts";

/** Each group is read into memory whole, and `Store.putImages` takes at most this many per SQL request. */
const IMAGES_PER_GROUP = 100;
const MAX_CONCURRENT_DIFFS = 6;
const HUMAN_LINES = 30;
const STABILITY_NOT_RUN =
  "Stability wasn't checked, so no story can be flagged as unstable. Pass --stability to render every story twice.";

export interface ReviewFlags {
  readonly storybookDir: string;
  readonly buildCommand?: string | undefined;
  readonly config?: string | undefined;
  readonly native?: boolean | undefined;
  readonly story?: string[] | undefined;
  readonly initScript?: string | undefined;
  readonly stability?: boolean | undefined;
  readonly human?: boolean | undefined;
}

export type AttentionReason =
  | "failed"
  | "play-error"
  | "unstable"
  | "changed-unapproved"
  | "new-unapproved"
  | "rejected"
  | "removed"
  | "pattern-unmatched";

export interface Attention {
  /** Null only for `pattern-unmatched`. */
  readonly story: string | null;
  readonly reason: AttentionReason;
  readonly detail: string;
}

export interface Difference {
  readonly story: string;
  readonly state: "changed" | "new" | "removed";
  readonly decision: Decision | null;
  readonly unstable: boolean | null;
  readonly imageHash: string | null;
  readonly goldenHash: string | null;
  /** Absolute paths. `current` is null if removed, `golden` if new, `diff` unless pixels could be compared. */
  readonly current: string | null;
  readonly golden: string | null;
  readonly diff: string | null;
  /** Null unless `changed`. */
  readonly pixelDiff: PixelDiff | null;
}

/** What `selfie review` prints, and also what it keeps for later commands as `review.json`. */
export interface ReviewOutput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: RunStatus;
  readonly gitSha: string;
  /** Whether the tree had changes while this ran, so the images may not describe `gitSha`. */
  readonly dirty: boolean;
  readonly dirtyPaths: readonly string[];
  readonly baselineSha: string | null;
  readonly baseline: BaselineResult;
  readonly environment: { readonly id: string; readonly definition: RenderEnvironment };
  readonly initScriptSha256: string | null;
  readonly storybookDir: string;
  /** The per-run directory holding every image path below. */
  readonly outputDir: string;
  /** Set if `--story` limited this run. `notRendered` is how many goldens it didn't try to match. */
  readonly filter: { readonly patterns: readonly string[]; readonly notRendered: number } | null;
  readonly stability: { readonly checked: boolean; readonly note: string | null };
  readonly counts: {
    readonly stories: number;
    readonly unchanged: number;
    readonly changed: number;
    readonly new: number;
    readonly removed: number;
    readonly failed: number;
    readonly playErrors: number;
    /** Null if stability wasn't checked. */
    readonly unstable: number | null;
    readonly approved: number;
    readonly rejected: number;
    readonly undecided: number;
    readonly needsAttention: number;
  };
  readonly needsAttention: readonly Attention[];
  readonly differences: readonly Difference[];
  readonly failures: readonly { readonly story: string; readonly failure: string; readonly goldenHash: string | null }[];
  readonly playErrors: readonly {
    readonly story: string;
    readonly errors: readonly StoryError[];
    readonly current: string | null;
  }[];
  readonly unstable: readonly {
    readonly story: string;
    readonly current: string | null;
    /** The second render, if it succeeded. */
    readonly repeat: string | null;
  }[];
  readonly warnings: readonly string[];
  /** What to do next, as commands to run. */
  readonly next: readonly string[];
  readonly timings: {
    readonly captureMs: number;
    readonly storeMs: number;
    readonly compareMs: number;
    readonly diffMs: number;
    readonly totalMs: number;
  };
}

/** The user's own command, in a shell, on purpose. Its stdout goes to stderr, keeping stdout one document. */
function runBuildCommand(command: string, cwd: string, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, stdio: ["ignore", 2, 2], signal });
    child.once("error", (error) => reject(new CliError(`--build-command couldn't run: ${error.message}`)));
    child.once("close", (code, killedBy) => {
      if (code === 0) resolve();
      else reject(new CliError(`--build-command failed with ${killedBy ?? `exit code ${code}`}.`));
    });
  });
}

const describeErrors = (errors: readonly StoryError[]) =>
  errors.map(({ source, message }) => `${source}: ${message}`).join("; ") || "the story failed to render";

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

/** Puts the capture's images in the store. Returns one row per story, and each stored story's hash. */
async function storeCapture(
  project: Project,
  captureDir: string,
  manifest: Manifest,
): Promise<{ records: RecordedSnapshot[]; hashes: Map<string, string> }> {
  const records: RecordedSnapshot[] = [];
  const hashes = new Map<string, string>();
  for (let start = 0; start < manifest.stories.length; start += IMAGES_PER_GROUP) {
    const group = manifest.stories.slice(start, start + IMAGES_PER_GROUP);
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
      const hash = stored.hashes.get(story.id);
      if (hash !== undefined) {
        hashes.set(story.id, hash);
        records.push({ story: story.id, imageHash: hash, unstable: unstableFlag(story) });
      } else {
        records.push({ story: story.id, failure: failures.get(story.id)!, unstable: null });
      }
    }
  }
  return { records, hashes };
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
  if (bytes === null) throw new CliError(`Image ${hash} is missing from the local store.`);
  const file = path.join(directory, name);
  await writeFile(file, bytes);
  return { file, bytes };
}

async function storyDirectory(runDir: string, story: string): Promise<string> {
  const directory = path.join(runDir, "stories", storyDirName(story));
  await mkdir(directory, { recursive: true });
  return directory;
}

/** An unstable story's second render, which only exists in the capture, since it isn't the run's image. */
async function exportRepeat(captureDir: string, runDir: string, story: ManifestStory): Promise<string | null> {
  if (story.repeatFile === null) return null;
  const checked = await regularFileInside(captureDir, story.repeatFile);
  if ("refused" in checked) return null;
  const file = path.join(await storyDirectory(runDir, story.id), "repeat.png");
  await writeFile(file, await readFile(checked.file));
  return file;
}

/** Writes one difference's files, and computes a pixel diff if it is `changed`. */
async function exportDifference(project: Project, runDir: string, snapshot: ComparedSnapshot): Promise<Difference> {
  const { story, imageHash, goldenHash, decision, unstable } = snapshot;
  const directory = await storyDirectory(runDir, story);
  const current = imageHash === null ? null : await exportImage(project, directory, "current.png", imageHash);
  const golden = goldenHash === null ? null : await exportImage(project, directory, "golden.png", goldenHash);

  let pixelDiff: PixelDiff | null = null;
  let diff: string | null = null;
  if (snapshot.state === "changed" && current !== null && golden !== null) {
    const compared = diffImages(await decodeImage(current.bytes), await decodeImage(golden.bytes));
    pixelDiff = compared.diff;
    if (compared.highlighted !== null) {
      diff = path.join(directory, "diff.png");
      await writeFile(diff, await encodePng(compared.highlighted));
    }
  }
  return {
    story,
    state: snapshot.state as Difference["state"],
    decision,
    unstable,
    imageHash,
    goldenHash,
    current: current?.file ?? null,
    golden: golden?.file ?? null,
    diff,
    pixelDiff,
  };
}

function attentionForDifference(difference: Difference): Attention | null {
  const { story, state, decision, pixelDiff } = difference;
  if (state === "removed") {
    return { story, reason: "removed", detail: "The baseline has this story's golden, and this run doesn't have the story." };
  }
  if (decision?.decision === "approved") return null;
  if (decision?.decision === "rejected") {
    return { story, reason: "rejected", detail: `${decision.actor} rejected this image.` };
  }
  if (state === "new") return { story, reason: "new-unapproved", detail: "No golden yet, and this image isn't approved." };
  return {
    story,
    reason: "changed-unapproved",
    detail:
      pixelDiff?.kind === "size-differs"
        ? `The size changed from ${pixelDiff.golden.width}x${pixelDiff.golden.height} to ${pixelDiff.current.width}x${pixelDiff.current.height}, and this image isn't approved.`
        : `${pixelDiff?.kind === "pixels" ? pixelDiff.changedPixels : "Some"} pixels changed, and this image isn't approved.`,
  };
}

function nextSteps(
  runId: string,
  dirty: boolean,
  differences: readonly Difference[],
  removedTotal: number,
  failed: number,
): string[] {
  const steps: string[] = [];
  const undecided = differences.filter(({ state, decision }) => state !== "removed" && decision === null).length;
  if (undecided > 0) {
    steps.push(`Look at the images, then: selfie approve ${runId} --all, or with --story <pattern>, or selfie reject.`);
  }
  if (failed > 0) steps.push("A run with failed stories can't be accepted. Fix them and review again.");
  if (dirty) {
    steps.push("This tree is dirty, so this run can't become goldens. Commit, and review again: approvals carry over.");
  } else if (differences.length > 0 && failed === 0) {
    const removed = removedTotal > 0 ? ` --removed ${removedTotal}` : "";
    steps.push(`Once every image is approved, make this run its commit's goldens: selfie accept ${runId}${removed}`);
  }
  return steps;
}

function humanSummary(output: ReviewOutput): string {
  const { counts } = output;
  const lines = [
    `Run ${output.runId} at ${output.gitSha.slice(0, 12)}${output.dirty ? " (dirty)" : ""}, baseline ${output.baselineSha?.slice(0, 12) ?? "none"}`,
    `${counts.stories} stories: ${counts.unchanged} unchanged, ${counts.changed} changed, ${counts.new} new, ${counts.removed} removed, ${counts.failed} failed`,
    ...(output.stability.checked ? [] : ["Stability wasn't checked."]),
  ];
  if (output.needsAttention.length > 0) {
    lines.push(`Needs attention (${output.needsAttention.length}):`);
    for (const { story, reason } of output.needsAttention.slice(0, HUMAN_LINES)) {
      lines.push(`  ${reason}: ${story}`);
    }
    if (output.needsAttention.length > HUMAN_LINES) lines.push("  ...");
  }
  lines.push(...output.next);
  return `${lines.join("\n")}\n`;
}

export async function reviewCommand(flags: ReviewFlags, context: Context): Promise<number> {
  const started = Date.now();
  const log = (line: string) => context.stderr(`${line}\n`);
  const project = await openProject(context);
  const { repo } = project;
  const captureDir = captureDirectory(project, randomUUID());
  try {
    const storybookDir = path.resolve(context.cwd, flags.storybookDir);
    if (flags.buildCommand !== undefined) {
      log(`Building: ${flags.buildCommand}`);
      await runBuildCommand(flags.buildCommand, context.cwd, context.signal);
    }

    // After the build, whose output is part of what is being described.
    const { sha: gitSha } = await readHead(repo);
    if (gitSha === null) {
      throw new CliError("This repository has no commits yet, and a run is recorded against a Git SHA. Commit first.");
    }
    const settings = await resolveCaptureSettings(flags, context.cwd, repo);
    const baseline = await findBaseline(repo, settings.environmentId, (sha) =>
      project.snapshots.hasCompleteGoldens(sha, settings.environmentId),
    );
    const dirtyBefore = await dirtyPaths(repo);

    const captureStarted = Date.now();
    const manifest = await context.capture({
      storybookDir,
      outDir: captureDir,
      environment: settings.environment,
      stability: flags.stability ?? false,
      log,
      ...(flags.story === undefined ? {} : { stories: flags.story }),
      ...(settings.initScript === undefined ? {} : { initScript: settings.initScript }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    const captured = Date.now();
    if (manifest.stories.length === 0) {
      throw new CliError(
        flags.story === undefined
          ? `The Storybook at ${storybookDir} has no stories.`
          : `No story matched --story ${flags.story.join(", ")}.`,
      );
    }

    // A moved HEAD means no one commit describes what was rendered.
    const { sha: shaAfter } = await readHead(repo);
    if (shaAfter !== gitSha) {
      throw new CliError(`HEAD moved from ${gitSha} to ${shaAfter} during the render, so review again.`);
    }
    const dirty = [...new Set([...dirtyBefore, ...(await dirtyPaths(repo))])];

    const { snapshots } = project;
    const run = await snapshots.beginRun({ gitSha, environment: settings.environmentId });
    const { records, hashes } = await storeCapture(project, captureDir, manifest);
    await snapshots.recordSnapshots(run.id, records);
    const finished = await snapshots.finishRun(run.id, records.length);
    const stored = Date.now();
    log(`Recorded run ${run.id}: ${records.length} stories.`);

    const comparison = await snapshots.compareRun(run.id, baseline.baselineSha);
    const compared = Date.now();

    const runDir = runDirectory(project, run.id);
    await mkdir(runDir, { recursive: true });
    const isDifference = ({ state }: ComparedSnapshot) => state === "changed" || state === "new" || state === "removed";

    const patterns = flags.story ?? null;
    const inFilter = (story: string) =>
      patterns === null || filterStories([{ id: story, title: "", name: "" }], patterns).stories.length > 0;
    const shown = comparison.snapshots.filter((snapshot) => isDifference(snapshot) && inFilter(snapshot.story));
    const removedTotal = comparison.snapshots.filter(({ state }) => state === "removed").length;
    log(`Comparing: ${shown.length} differences.`);

    const differences = await mapConcurrently(
      shown,
      Math.min(MAX_CONCURRENT_DIFFS, availableParallelism()),
      (snapshot) => exportDifference(project, runDir, snapshot),
    );
    const failed = comparison.snapshots.filter(({ state }) => state === "failed");

    // Unchanged stories can need attention too, so these get their images here.
    const exportCurrent = async (story: ManifestStory) => {
      const hash = hashes.get(story.id);
      if (hash === undefined) return null;
      const directory = await storyDirectory(runDir, story.id);
      return (await exportImage(project, directory, "current.png", hash)).file;
    };
    const playErrors = await Promise.all(
      manifest.stories
        .filter(({ errors }) => errors.some(({ source }) => source === "play"))
        .map(async (story) => ({
          story: story.id,
          errors: story.errors.filter(({ source }) => source === "play"),
          current: await exportCurrent(story),
        })),
    );
    const unstable = await Promise.all(
      manifest.stories
        .filter(({ stability }) => stability === "unstable")
        .map(async (story) => ({
          story: story.id,
          current: await exportCurrent(story),
          repeat: await exportRepeat(captureDir, runDir, story),
        })),
    );
    const diffed = Date.now();

    const unmatched = patterns === null ? [] : filterStories(manifest.stories, patterns).unmatched;
    const needsAttention: Attention[] = [
      ...failed.map(({ story, failure }) => ({
        story,
        reason: "failed" as const,
        detail: failure ?? "The story failed to render.",
      })),
      ...playErrors.map(({ story, errors }) => ({
        story,
        reason: "play-error" as const,
        detail: describeErrors(errors),
      })),
      ...unstable.map(({ story }) => ({
        story,
        reason: "unstable" as const,
        detail: "Rendering this story twice gave different images.",
      })),
      ...differences.flatMap((difference) => attentionForDifference(difference) ?? []),
      ...unmatched.map((pattern) => ({
        story: null,
        reason: "pattern-unmatched" as const,
        detail: `--story ${pattern} matched nothing.`,
      })),
    ];
    const decided = (kind: Decision["decision"]) =>
      differences.filter(({ decision }) => decision?.decision === kind).length;

    const output: ReviewOutput = {
      schemaVersion: 1,
      runId: run.id,
      status: finished.status,
      gitSha,
      dirty: dirty.length > 0,
      dirtyPaths: dirty.slice(0, 20),
      baselineSha: baseline.baselineSha,
      baseline,
      environment: { id: settings.environmentId, definition: settings.environment },
      initScriptSha256: manifest.initScriptSha256,
      storybookDir,
      outputDir: runDir,
      filter: patterns === null ? null : { patterns, notRendered: removedTotal - differences.filter(({ state }) => state === "removed").length },
      stability: flags.stability
        ? { checked: true, note: null }
        : { checked: false, note: STABILITY_NOT_RUN },
      counts: {
        stories: records.length,
        unchanged: comparison.unchangedCount,
        changed: differences.filter(({ state }) => state === "changed").length,
        new: differences.filter(({ state }) => state === "new").length,
        removed: differences.filter(({ state }) => state === "removed").length,
        failed: failed.length,
        playErrors: playErrors.length,
        unstable: flags.stability ? unstable.length : null,
        approved: decided("approved"),
        rejected: decided("rejected"),
        undecided: differences.filter(({ state, decision }) => state !== "removed" && decision === null).length,
        needsAttention: needsAttention.length,
      },
      needsAttention,
      differences,
      failures: failed.map(({ story, failure, goldenHash }) => ({ story, failure: failure ?? "", goldenHash })),
      playErrors,
      unstable,
      warnings: manifest.warnings,
      next: nextSteps(run.id, dirty.length > 0, differences, removedTotal, failed.length),
      timings: {
        captureMs: captured - captureStarted,
        storeMs: stored - captured,
        compareMs: compared - stored,
        diffMs: diffed - compared,
        totalMs: Date.now() - started,
      },
    };

    await writeRunRecord(project, run.id, output);
    await pruneOutput(project, run.id);
    if (flags.human) context.stdout(humanSummary(output));
    else printJson(context, output);
    return needsAttention.length > 0 ? EXIT_NEEDS_ATTENTION : EXIT_OK;
  } finally {
    await rm(captureDir, { recursive: true, force: true });
    project.close();
  }
}
