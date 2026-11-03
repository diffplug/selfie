// One project's local data: `<home>/<slug>/`, which holds its store, the per-run directories
// reviews write, and the scratch directories captures use. Every fact about a run is in the
// store: a run directory is only a disposable cache of what was exported for it.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemBlobStorage } from "selfie-store/adapters/filesystem-blob";
import { sharpCodec } from "selfie-store/adapters/sharp-codec";
import { SqliteAdapter } from "selfie-store/adapters/sqlite";
import { Blobs, initStoreSchema, Snapshots, Sql, Store, StorybookBuilds, type CompareOptions, type Comparison, type Run } from "selfie-store";
import type { PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { headSha, nearestOnBranch, openRepo, walkToBaseline, type BaselineSearch, type Repo } from "./git.ts";
import { CREATE_NOTES_TABLES, notesIn, type Notes } from "./notes.ts";
import { assertRunId, isRunId, projectSlug, selfieHome } from "./paths.ts";

/** How many runs keep their exported images. Older ones are deleted by the next review. */
const RUN_DIRECTORIES_KEPT = 20;
/** A capture directory this old belongs to a process that crashed. */
const STALE_CAPTURE_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "review.json";

/**
 * The newest real render of each build this machine can reuse. Local only: it's in the project's
 * `store.db`, and not in the store's schema, which D1 also has.
 */
export interface Renders {
  /** The run remembered for a render identity, or null. */
  readonly find: (identity: string) => Promise<string | null>;
  /** Remembers a run for it, or with null forgets what was. */
  readonly remember: (identity: string, runId: string | null) => Promise<void>;
}

function rendersIn(sql: Sql): Renders {
  return {
    async find(identity) {
      const [row] = await sql.run({
        sql: "SELECT run_id FROM render_keys WHERE key = ?1",
        params: [identity],
        idempotent: true,
      });
      return (row?.run_id as string | undefined) ?? null;
    },
    async remember(identity, runId) {
      await sql.run(
        runId === null
          ? { sql: "DELETE FROM render_keys WHERE key = ?1", params: [identity], idempotent: true }
          : {
              sql: `INSERT INTO render_keys(key, run_id) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET run_id = excluded.run_id`,
              params: [identity, runId],
              idempotent: true,
            },
      );
    },
  };
}

export interface Project {
  /** What a relative path in a request is relative to. */
  readonly cwd: string;
  readonly repo: Repo;
  /** `<home>/<slug>` */
  readonly directory: string;
  readonly renders: Renders;
  readonly notes: Notes;
  readonly store: Store;
  readonly builds: StorybookBuilds;
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
  await sql.run({ sql: "CREATE TABLE IF NOT EXISTS render_keys (key TEXT PRIMARY KEY, run_id TEXT NOT NULL) WITHOUT ROWID" });
  for (const statement of CREATE_NOTES_TABLES) await sql.run({ sql: statement });
  const blob = new Blobs(new FilesystemBlobStorage(path.join(directory, "blobs")));
  return {
    cwd,
    repo,
    directory,
    renders: rendersIn(sql),
    notes: notesIn(sql, repo.root),
    store: new Store({ sql, blob, codec: sharpCodec }),
    builds: new StorybookBuilds({ sql, blob }),
    snapshots: new Snapshots({ sql }),
    close: () => adapter.close(),
  };
}

/** HEAD, and the runs there in an environment, newest first. */
export async function runsAtHead(project: Project, environment: string): Promise<{ readonly head: string | null; readonly runs: readonly Run[] }> {
  const head = await headSha(project.repo);
  return { head, runs: head === null ? [] : await project.snapshots.runsAt(head, environment) };
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
  const run = await requireRun(project, runId);
  return project.snapshots.compareRun(runId, run.baselineSha, options);
}

/** A run someone named, which must be well formed and in this project's store. */
export async function requireRun(project: Project, runId: string): Promise<Run> {
  assertRunId(runId);
  const run = await project.snapshots.getRun(runId);
  if (run === null) throw new SelfieError("unknown-run", `No run ${runId} in this project's local store.`);
  return run;
}

/**
 * What a person should see a run with no baseline against: the nearest goldens on its branch, if
 * it has any. Only to look at. They're never its baseline, so deciding and accepting use
 * `compareAsReviewed`.
 */
export async function branchGoldens(project: Project, run: Run): Promise<string | null> {
  if (run.baselineSha !== null) return null;
  return nearestOnBranch(project.repo, run.gitSha, (shas) => project.snapshots.firstWithGoldens(shas, run.environment));
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
