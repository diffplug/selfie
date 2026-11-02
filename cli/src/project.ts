// One project's local data: `<home>/<slug>/`, which holds its store, the per-run directories
// reviews write, and the scratch directories captures use. Every fact about a run is in the
// store: a run directory is only a disposable cache of what was exported for it.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemBlobStorage } from "selfie-store/adapters/filesystem-blob";
import { SqliteAdapter } from "selfie-store/adapters/sqlite";
import { Blobs, initStoreSchema, Snapshots, Sql, Store, type CompareOptions, type Comparison } from "selfie-store";
import type { PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { openRepo, walkToBaseline, type BaselineSearch, type Repo } from "./git.ts";
import { assertRunId, isRunId, projectSlug, selfieHome } from "./paths.ts";

/** How many runs keep their exported images. Older ones are deleted by the next review. */
const RUN_DIRECTORIES_KEPT = 20;
/** A capture directory this old belongs to a process that crashed. */
const STALE_CAPTURE_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "review.json";

export interface Project {
  /** What a relative path in a request is relative to. */
  readonly cwd: string;
  readonly repo: Repo;
  /** `<home>/<slug>` */
  readonly directory: string;
  readonly store: Store;
  readonly snapshots: Snapshots;
  readonly close: () => void;
}

/** Opens the store of the repository at `cwd`, creating it if this is the first command there. */
export async function openProject({ cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }): Promise<Project> {
  const repo = await openRepo(cwd);
  const directory = path.join(selfieHome(env), projectSlug(repo));
  // Screenshots of a private repository are nobody else's business on a shared machine.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const adapter = new SqliteAdapter(path.join(directory, "store.db"));
  const sql = new Sql(adapter);
  await initStoreSchema(sql);
  return {
    cwd,
    repo,
    directory,
    store: new Store({ sql, blob: new Blobs(new FilesystemBlobStorage(path.join(directory, "blobs"))) }),
    snapshots: new Snapshots({ sql }),
    close: () => adapter.close(),
  };
}

/** The baseline this project would use now, in an environment. */
export function findBaseline(project: Project, environment: string): Promise<BaselineSearch> {
  return walkToBaseline(project.repo, (shas) => project.snapshots.firstWithGoldens(shas, environment));
}

/** A run compared with the baseline its reviewer saw. */
export async function compareAsReviewed(
  project: Project,
  runId: string,
  options?: CompareOptions,
): Promise<Comparison> {
  assertRunId(runId);
  const run = await project.snapshots.getRun(runId);
  if (run === null) throw new SelfieError("unknown-run", `No run ${runId} in this project's local store.`);
  return project.snapshots.compareRun(runId, run.baselineSha, options);
}

export const runDirectory = (project: Project, runId: string) => path.join(project.directory, "runs", runId);

/** A new directory for one capture, so concurrent reviews never share one. */
export const captureDirectory = (project: Project, id: string) => path.join(project.directory, "capture", id);

/** What a review exported, kept beside the images. Losing it loses no fact: the store has them all. */
export interface ReviewCache {
  readonly differences: readonly {
    readonly story: string;
    readonly current: string | null;
    readonly golden: string | null;
    readonly diff: string | null;
    readonly pixelDiff: PixelDiff | null;
  }[];
  readonly playErrors: readonly { readonly story: string; readonly current: string | null }[];
  readonly unstable: readonly {
    readonly story: string;
    readonly current: string | null;
    readonly repeat: string | null;
  }[];
}

/** Atomic, so a reader never sees half of one. */
export async function writeReviewCache(project: Project, runId: string, cache: ReviewCache): Promise<void> {
  const target = path.join(runDirectory(project, runId), CACHE_FILE);
  await writeFile(`${target}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

/** The paths and pixel diffs a review exported, or null if they've been pruned. */
export async function readReviewCache(project: Project, runId: string): Promise<ReviewCache | null> {
  assertRunId(runId);
  const text = await readFile(path.join(runDirectory(project, runId), CACHE_FILE), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as ReviewCache);
}

/**
 * Keeps the newest runs' directories, and drops capture directories left by a crash. Only ever
 * touches names it would have created itself, directly under these two directories.
 */
export async function pruneOutput(project: Project, keepRunId: string): Promise<void> {
  const runsRoot = path.join(project.directory, "runs");
  const dated = async (root: string) => {
    const names = await readdir(root).catch(() => [] as string[]);
    const entries = await Promise.all(
      names.filter(isRunId).map(async (name) => {
        const stats = await stat(path.join(root, name)).catch(() => null);
        return { name, modified: stats?.mtimeMs ?? 0 };
      }),
    );
    return entries.sort((a, b) => b.modified - a.modified);
  };

  const runs = (await dated(runsRoot)).filter(({ name }) => name !== keepRunId);
  await Promise.all(
    runs
      .slice(RUN_DIRECTORIES_KEPT - 1)
      .map(({ name }) => rm(path.join(runsRoot, name), { recursive: true, force: true })),
  );

  const captureRoot = path.join(project.directory, "capture");
  const oldest = Date.now() - STALE_CAPTURE_MS;
  await Promise.all(
    (await dated(captureRoot))
      .filter(({ modified }) => modified < oldest)
      .map(({ name }) => rm(path.join(captureRoot, name), { recursive: true, force: true })),
  );
}
