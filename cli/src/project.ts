// One project's local data: `<home>/<slug>/`, which holds its store, the per-batch directories
// reviews write, and the scratch directories renders use. Every fact about a batch is in the
// store: a batch directory is only a disposable cache of what was exported for it.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemBlobStorage } from "selfie-store/adapters/filesystem-blob";
import { sharpCodec } from "selfie-store/adapters/sharp-codec";
import { SqliteAdapter } from "selfie-store/adapters/sqlite";
import { Blobs, initStoreSchema, RenderBatches, Sql, Store, BuiltStorybooks, type CompareOptions, type Comparison, type RenderBatch } from "selfie-store";
import type { PixelDiff } from "./diff.ts";
import { SelfieError } from "./errors.ts";
import { headSha, nearestOnBranch, openRepo, walkToBaseline, type BaselineSearch, type Repo } from "./git.ts";
import { CREATE_NOTES_TABLES, notesIn, type Notes } from "./notes.ts";
import { assertBatchId, isBatchId, projectSlug, selfieHome } from "./paths.ts";

/** How many batches keep their exported images. Older ones are deleted by the next review. */
const BATCH_DIRECTORIES_KEPT = 20;
/** A render directory this old belongs to a process that crashed. */
const STALE_RENDER_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "review.json";

/**
 * The newest real render of each built Storybook this machine can reuse. Local only: it's in the project's
 * `store.db`, and not in the store's schema, which D1 also has.
 */
export interface RenderKeys {
  /** The batch remembered for a render identity, or null. */
  readonly find: (identity: string) => Promise<string | null>;
  /** Remembers a batch for it, or with null forgets what was. */
  readonly remember: (identity: string, batchId: string | null) => Promise<void>;
}

function renderKeysIn(sql: Sql): RenderKeys {
  return {
    async find(identity) {
      const [row] = await sql.run({
        sql: "SELECT batch_id FROM render_keys WHERE key = ?1",
        params: [identity],
        idempotent: true,
      });
      return (row?.batch_id as string | undefined) ?? null;
    },
    async remember(identity, batchId) {
      await sql.run(
        batchId === null
          ? { sql: "DELETE FROM render_keys WHERE key = ?1", params: [identity], idempotent: true }
          : {
              sql: `INSERT INTO render_keys(key, batch_id) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET batch_id = excluded.batch_id`,
              params: [identity, batchId],
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
  readonly renderKeys: RenderKeys;
  readonly notes: Notes;
  readonly store: Store;
  readonly storybooks: BuiltStorybooks;
  readonly batches: RenderBatches;
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
  await sql.run({ sql: "CREATE TABLE IF NOT EXISTS render_keys (key TEXT PRIMARY KEY, batch_id TEXT NOT NULL) WITHOUT ROWID" });
  for (const statement of CREATE_NOTES_TABLES) await sql.run({ sql: statement });
  const blob = new Blobs(new FilesystemBlobStorage(path.join(directory, "blobs")));
  return {
    cwd,
    repo,
    directory,
    renderKeys: renderKeysIn(sql),
    notes: notesIn(sql, repo.root),
    store: new Store({ sql, blob, codec: sharpCodec }),
    storybooks: new BuiltStorybooks({ sql, blob }),
    batches: new RenderBatches({ sql }),
    close: () => adapter.close(),
  };
}

/** HEAD, and the batches there in an environment, newest first. */
export async function batchesAtHead(project: Project, environment: string): Promise<{ readonly head: string | null; readonly batches: readonly RenderBatch[] }> {
  const head = await headSha(project.repo);
  return { head, batches: head === null ? [] : await project.batches.batchesAt(head, environment) };
}

/** The baseline this project would use now, in an environment. */
export function findBaseline(project: Project, environment: string): Promise<BaselineSearch> {
  return walkToBaseline(project.repo, (shas) => project.batches.firstWithGoldens(shas, environment));
}

/** A batch's comparison with every story in it, against what its screens show it against. */
export async function compareAsShown(project: Project, batch: RenderBatch, against?: string | null): Promise<Comparison> {
  const sha = against !== undefined ? against : ((await branchGoldens(project, batch)) ?? batch.baselineSha);
  return project.batches.compareBatch(batch.id, sha, { includeUnchanged: true });
}

/** A batch compared with the baseline its reviewer saw. */
export async function compareAsReviewed(
  project: Project,
  batchId: string,
  options?: CompareOptions,
): Promise<Comparison> {
  const batch = await requireBatch(project, batchId);
  return project.batches.compareBatch(batchId, batch.baselineSha, options);
}

/** A batch someone named, which must be well formed and in this project's store. */
export async function requireBatch(project: Project, batchId: string): Promise<RenderBatch> {
  assertBatchId(batchId);
  const batch = await project.batches.getBatch(batchId);
  if (batch === null) throw new SelfieError("unknown-batch", `No batch ${batchId} in this project's local store.`);
  return batch;
}

/**
 * What a person should see a batch with no baseline against: the nearest goldens on its branch, if
 * it has any. Only to look at. They're never its baseline, so deciding and accepting use
 * `compareAsReviewed`.
 */
export async function branchGoldens(project: Project, batch: RenderBatch): Promise<string | null> {
  if (batch.baselineSha !== null) return null;
  return nearestOnBranch(project.repo, batch.gitSha, (shas) => project.batches.firstWithGoldens(shas, batch.environment));
}

export const batchDirectory = (project: Project, batchId: string) => path.join(project.directory, "batches", batchId);

/** A new directory for one render, so concurrent reviews never share one. */
export const renderDirectory = (project: Project, id: string) => path.join(project.directory, "render", id);

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
export async function writeReviewCache(project: Project, batchId: string, cache: ReviewCache): Promise<void> {
  const target = path.join(batchDirectory(project, batchId), CACHE_FILE);
  await writeFile(`${target}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

/** The paths and pixel diffs a review exported, or null if they've been pruned. */
export async function readReviewCache(project: Project, batchId: string): Promise<ReviewCache | null> {
  assertBatchId(batchId);
  const text = await readFile(path.join(batchDirectory(project, batchId), CACHE_FILE), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as ReviewCache);
}

/**
 * Keeps the newest batches' directories, and drops render directories left by a crash. Only ever
 * touches names it would have created itself, directly under these two directories.
 */
export async function pruneOutput(project: Project, keepBatchId: string): Promise<void> {
  const batchesRoot = path.join(project.directory, "batches");
  const dated = async (root: string) => {
    const names = await readdir(root).catch(() => [] as string[]);
    const entries = await Promise.all(
      names.filter(isBatchId).map(async (name) => {
        const stats = await stat(path.join(root, name)).catch(() => null);
        return { name, modified: stats?.mtimeMs ?? 0 };
      }),
    );
    return entries.sort((a, b) => b.modified - a.modified);
  };

  const batches = (await dated(batchesRoot)).filter(({ name }) => name !== keepBatchId);
  await Promise.all(
    batches
      .slice(BATCH_DIRECTORIES_KEPT - 1)
      .map(({ name }) => rm(path.join(batchesRoot, name), { recursive: true, force: true })),
  );

  const renderRoot = path.join(project.directory, "render");
  const oldest = Date.now() - STALE_RENDER_MS;
  await Promise.all(
    (await dated(renderRoot))
      .filter(({ modified }) => modified < oldest)
      .map(({ name }) => rm(path.join(renderRoot, name), { recursive: true, force: true })),
  );
}
