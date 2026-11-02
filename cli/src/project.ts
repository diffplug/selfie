// One project's local data: `<home>/<slug>/`, which holds its store, the per-run directories
// reviews write, and the scratch directories captures use.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemBlobStorage } from "selfie-store/adapters/filesystem-blob";
import { SqliteAdapter } from "selfie-store/adapters/sqlite";
import { Blobs, initStoreSchema, Snapshots, Sql, Store } from "selfie-store";
import { openRepo, type Repo } from "./git.ts";
import { assertRunId, isRunId, projectSlug, selfieHome } from "./paths.ts";
import { CliError, type Context } from "./output.ts";

/** How many runs keep their directory of images and record. Older ones are deleted by the next review. */
export const RUN_DIRECTORIES_KEPT = 20;
/** A capture directory this old belongs to a process that crashed. */
const STALE_CAPTURE_MS = 24 * 60 * 60 * 1000;
const RECORD_FILE = "review.json";

export interface Project {
  readonly repo: Repo;
  /** `<home>/<slug>` */
  readonly directory: string;
  readonly store: Store;
  readonly snapshots: Snapshots;
  readonly close: () => void;
}

/** Opens the store of the repository at `cwd`, creating it if this is the first command there. */
export async function openProject(context: Context): Promise<Project> {
  const repo = await openRepo(context.cwd);
  const directory = path.join(selfieHome(context.env), projectSlug(repo));
  // Screenshots of a private repository are nobody else's business on a shared machine.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const adapter = new SqliteAdapter(path.join(directory, "store.db"));
  const sql = new Sql(adapter);
  await initStoreSchema(sql);
  return {
    repo,
    directory,
    store: new Store({ sql, blob: new Blobs(new FilesystemBlobStorage(path.join(directory, "blobs"))) }),
    snapshots: new Snapshots({ sql }),
    close: () => adapter.close(),
  };
}

export const runDirectory = (project: Project, runId: string) => path.join(project.directory, "runs", runId);

/** A new directory for one capture, so concurrent reviews never share one. */
export const captureDirectory = (project: Project, id: string) => path.join(project.directory, "capture", id);

/** Written last, and atomically, so a run with a record has everything its record names. */
export async function writeRunRecord(project: Project, runId: string, record: unknown): Promise<void> {
  const target = path.join(runDirectory(project, runId), RECORD_FILE);
  await writeFile(`${target}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

/** The record a review left for this run. Decisions need it for the baseline the reviewer saw. */
export async function readRunRecord<Shape>(project: Project, runId: string): Promise<Shape> {
  assertRunId(runId);
  const file = path.join(runDirectory(project, runId), RECORD_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) {
    const run = await project.snapshots.getRun(runId);
    throw new CliError(
      run === null
        ? `No run ${runId} in this project's local store.`
        : `Run ${runId} has no review record, either because it was only partly recorded or because it is older than the newest ${RUN_DIRECTORIES_KEPT} runs. Run \`selfie review\` again: approvals carry over.`,
    );
  }
  return JSON.parse(text) as Shape;
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
