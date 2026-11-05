import { chunks, STATEMENTS_PER_REQUEST } from "./chunks.ts";
import { missingImages } from "./hash-keys.ts";
import { assertImageHash } from "./image-hash.ts";
import type { Sql, SqlRow, SqlStatement } from "./sql.ts";

/**
 * The tables behind `RenderBatches`, which `initStoreSchema` creates. Anything repeated across a great
 * many rows is held once and named by an integer: an image, a batch, a story, a commit, an environment,
 * and an actor. Those keys stay private to this store: everything this
 * module takes or returns names each by its own text. See `docs/specs/renders.md` -> Schema.
 */
export const CREATE_BATCH_TABLES: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS environments (key INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE)",
  "CREATE TABLE IF NOT EXISTS stories (key INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE)",
  "CREATE TABLE IF NOT EXISTS commits (key INTEGER PRIMARY KEY, sha TEXT NOT NULL UNIQUE)",
  "CREATE TABLE IF NOT EXISTS actors (key INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
  `CREATE TABLE IF NOT EXISTS render_batches (
  key INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  commit_key INTEGER NOT NULL REFERENCES commits(key),
  environment_key INTEGER NOT NULL REFERENCES environments(key),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  failed_count INTEGER,
  dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
  story_filter TEXT,
  reused_from_batch TEXT,
  scale REAL NOT NULL,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  branch TEXT,
  storybook_key INTEGER REFERENCES built_storybooks(key)
)`,
  "CREATE INDEX IF NOT EXISTS batches_by_commit ON render_batches(commit_key, environment_key, started_at)",
  "CREATE INDEX IF NOT EXISTS batches_by_branch ON render_batches(branch, environment_key, started_at)",
  `CREATE TABLE IF NOT EXISTS renders (
  batch_key INTEGER NOT NULL REFERENCES render_batches(key),
  story_key INTEGER NOT NULL REFERENCES stories(key),
  image_key INTEGER REFERENCES images(key),
  failure TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  PRIMARY KEY (batch_key, story_key),
  CHECK (image_key IS NOT NULL OR failure IS NOT NULL),
  CHECK ((viewport_width IS NULL) = (viewport_height IS NULL))
) WITHOUT ROWID`,
  // By commit first, since what history reaches is read a commit at a time. An image key of 0, which no
  // image is ever given, is a decision on a story being gone, so that column can't be a foreign key. Its
  // batch may never have come here, so that stays an ID.
  `CREATE TABLE IF NOT EXISTS decisions (
  environment_key INTEGER NOT NULL REFERENCES environments(key),
  commit_key INTEGER NOT NULL REFERENCES commits(key),
  story_key INTEGER NOT NULL REFERENCES stories(key),
  image_key INTEGER NOT NULL,
  rejected INTEGER NOT NULL CHECK (rejected IN (0, 1)),
  decided_at INTEGER NOT NULL,
  actor_key INTEGER NOT NULL REFERENCES actors(key),
  batch_id TEXT NOT NULL,
  PRIMARY KEY (environment_key, commit_key, story_key, image_key)
) WITHOUT ROWID`,
  "CREATE INDEX IF NOT EXISTS decisions_by_image ON decisions(environment_key, story_key, image_key)",
  // Which commits came before which, for a server with no Git to ask. Only ever added to, by whoever pushes.
  `CREATE TABLE IF NOT EXISTS commit_parents (
  commit_key INTEGER NOT NULL REFERENCES commits(key),
  parent_key INTEGER NOT NULL REFERENCES commits(key),
  PRIMARY KEY (commit_key, parent_key)
) WITHOUT ROWID`,
];

// Each as one bound parameter. Renders by what a request of them was measured at, and decisions of about 200 bytes.
const RENDERS_PER_STATEMENT = 49;
const DECISIONS_PER_STATEMENT = 200;
// As one bound parameter, in a statement that gives them all keys.
const NAMES_PER_STATEMENT = 1_000;

// Sizes measured on real D1: `docs/specs/renders.rationale.md`.
const ROWS_PER_PAGE = 5_000;

// Enough to read, and it bounds how large one request can grow.
const MAX_MESSAGE_CHARACTERS = 2_000;

const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A full SHA-1 or SHA-256 commit ID. */
export const isGitSha = (value: string) => GIT_SHA.test(value);
/** What leaves a store to name a batch. */
export const isBatchId = (value: string) => BATCH_ID.test(value);

// As `git rev-list` is asked for: see `docs/specs/renders.md` -> Scope: approvals-sync.
const MAX_REACHED_COMMITS = 1_000;

// Subqueries rather than joins, since a `RETURNING` can't join.
const BATCH_COLUMNS = `id, (SELECT sha FROM commits WHERE key = commit_key) AS git_sha,
  (SELECT id FROM environments WHERE key = environment_key) AS environment,
  started_at, finished_at, failed_count, dirty, story_filter, reused_from_batch, scale, viewport_width, viewport_height, branch`;

const SELECT_BATCH = `SELECT ${BATCH_COLUMNS} FROM render_batches WHERE id = ?1`;

const BATCH_KEY = "(SELECT key FROM render_batches WHERE id = ?1)";
const commitKey = (sha: string) => `(SELECT key FROM commits WHERE sha = ${sha})`;
const environmentKey = (id: string) => `(SELECT key FROM environments WHERE id = ${id})`;

// The key of a finished batch named by ?2, only ever in the batch's own environment.
const NAMED_BATCH_KEY = `(SELECT b.key FROM render_batches b
  WHERE b.id = ?2 AND b.finished_at IS NOT NULL
    AND b.environment_key = (SELECT environment_key FROM render_batches WHERE id = ?1))`;

// A story and image can have a decision per commit. What reads one without history in hand wants the
// newest, latest first, and at the same moment a rejection, then by commit so that one row wins.
// The index is named since SQLite, without statistics, picks the primary key, and so reads every decision
// in the environment for every render: `docs/specs/renders.rationale.md` -> Finding a decision by its image.
const DECISION_ON_RENDER = `LEFT JOIN decisions d INDEXED BY decisions_by_image ON d.environment_key = r.environment_key AND d.story_key = rs.story_key
  AND d.image_key = rs.image_key
  AND NOT EXISTS (SELECT 1 FROM decisions n INDEXED BY decisions_by_image
    WHERE n.environment_key = d.environment_key AND n.story_key = d.story_key AND n.image_key = d.image_key
      AND (n.decided_at, n.rejected, n.commit_key) > (d.decided_at, d.rejected, d.commit_key))
LEFT JOIN actors a ON a.key = d.actor_key`;

const DECISION_WORD = "CASE d.rejected WHEN 1 THEN 'rejected' WHEN 0 THEN 'approved' END";

/** A comparison's statements, against the finished batch named by ?2. */
const AGAINST_BATCH = {
  baseline: `SELECT ${NAMED_BATCH_KEY} AS batch_key`,
  // `gs` joins before the images so that a row left out never reads them.
  comparedPage: `SELECT rs.story_key, s.id AS story, i.hash AS image_hash, rs.failure,
  gi.hash AS golden_hash, ${DECISION_WORD} AS decision, a.name AS actor, d.decided_at
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN renders gs ON gs.batch_key = ${NAMED_BATCH_KEY} AND gs.story_key = rs.story_key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN images gi ON gi.key = gs.image_key
${DECISION_ON_RENDER}
LEFT JOIN stories s ON s.key = rs.story_key
WHERE r.id = ?1 AND rs.story_key > CAST(?3 AS INTEGER)
  AND (CAST(?5 AS INTEGER) = 1 OR rs.failure IS NOT NULL
    OR rs.image_key IS NOT gs.image_key)
ORDER BY rs.story_key
LIMIT CAST(?4 AS INTEGER)`,
  removedPage: `SELECT gs.story_key, s.id AS story, gi.hash AS golden_hash
FROM renders gs
JOIN images gi ON gi.key = gs.image_key
JOIN stories s ON s.key = gs.story_key
WHERE gs.batch_key = ${NAMED_BATCH_KEY} AND gs.story_key > CAST(?3 AS INTEGER)
  AND NOT EXISTS (SELECT 1 FROM renders rs
    WHERE rs.batch_key = ${BATCH_KEY} AND rs.story_key = gs.story_key)
ORDER BY gs.story_key
LIMIT CAST(?4 AS INTEGER)`,
  unchangedCount: `SELECT COUNT(*) AS total
FROM renders rs
JOIN renders gs ON gs.batch_key = ${NAMED_BATCH_KEY} AND gs.story_key = rs.story_key
WHERE rs.batch_key = ${BATCH_KEY} AND rs.image_key = gs.image_key AND rs.failure IS NULL`,
};

// Counted in the statement that marks the batch, so statements that never landed can't be
// marked finished. Running it again changes nothing, since a finished batch takes no rows.
const FINISH_BATCH = `UPDATE render_batches SET
  finished_at = COALESCE(finished_at, CAST(?2 AS INTEGER)),
  failed_count = c.failed
FROM (
  SELECT COUNT(*) AS total, COALESCE(SUM(failure IS NOT NULL), 0) AS failed
  FROM renders
  WHERE batch_key = ${BATCH_KEY}
) AS c
WHERE render_batches.id = ?1 AND c.total = CAST(?3 AS INTEGER)
RETURNING ${BATCH_COLUMNS}`;

const BATCH_PAGE_TAIL = `WHERE r.id = ?1 AND rs.story_key > CAST(?2 AS INTEGER)
ORDER BY rs.story_key
LIMIT CAST(?3 AS INTEGER)`;

const READ_BATCH_PAGE = `SELECT rs.story_key, s.id AS story, i.hash AS image_hash, rs.failure, rs.viewport_width, rs.viewport_height
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN stories s ON s.key = rs.story_key
${BATCH_PAGE_TAIL}`;

const READ_RENDERS_PAGE = `SELECT rs.story_key, s.id AS story, i.hash AS image_hash, rs.failure
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN stories s ON s.key = rs.story_key
${BATCH_PAGE_TAIL}`;

// A commit at a time, each of which is a range of the primary key. A commit this store has never heard of finds nothing.
// What `toPlacedDecision` reads, of a row of `d` and its commit `c`.
const PLACED_DECISION = `SELECT s.id AS story, i.hash AS image_hash, ${DECISION_WORD} AS decision, a.name AS actor, d.decided_at, d.batch_id, c.sha AS git_sha`;
const NAMES_OF_DECISION = `CROSS JOIN actors a ON a.key = d.actor_key
CROSS JOIN stories s ON s.key = d.story_key
LEFT JOIN images i ON i.key = d.image_key`;

// A commit at a time, each of which is a range of the primary key. A commit this store has never heard of finds nothing.
const DECISIONS_AT = `${PLACED_DECISION}
FROM json_each(?2) j
CROSS JOIN commits c ON c.sha = j.value
CROSS JOIN decisions d ON d.environment_key = ${environmentKey("?1")} AND d.commit_key = c.key
${NAMES_OF_DECISION}`;

// What a batch's commit reaches, walked by key, so that a long history's SHAs never leave the database.
const REACH_OF_BATCH = `WITH RECURSIVE reach(key) AS (
  SELECT commit_key FROM render_batches WHERE id = ?1
  UNION
  SELECT p.parent_key FROM reach r CROSS JOIN commit_parents p ON p.commit_key = r.key
  LIMIT ${MAX_REACHED_COMMITS}
)`;

const DECISIONS_REACHED = `${REACH_OF_BATCH}
${PLACED_DECISION}
FROM reach r
CROSS JOIN decisions d ON d.environment_key = (SELECT environment_key FROM render_batches WHERE id = ?1) AND d.commit_key = r.key
CROSS JOIN commits c ON c.key = d.commit_key
${NAMES_OF_DECISION}`;

/** The newest finished batch of a branch among these commits, in another's environment, and never at that one's own commit. */
const newestOfBranchWhere = (branch: string, environment: string, commit: string, commits: string) => `SELECT ${BATCH_COLUMNS} FROM render_batches
WHERE branch = ${branch} AND finished_at IS NOT NULL AND environment_key = ${environment} AND commit_key != ${commit} AND commit_key IN (${commits})
ORDER BY started_at DESC LIMIT 1`;

const BASE_REACHED = `${REACH_OF_BATCH}
${newestOfBranchWhere("?2", "(SELECT environment_key FROM render_batches WHERE id = ?1)", "(SELECT commit_key FROM render_batches WHERE id = ?1)", "SELECT key FROM reach")}`;

const BASE_AMONG = newestOfBranchWhere("?1", environmentKey("?2"), commitKey("?3"), "SELECT c.key FROM json_each(?4) j CROSS JOIN commits c ON c.sha = j.value");

const rendersPage = (batchId: string, after: string): SqlStatement => ({ sql: READ_RENDERS_PAGE, params: [batchId, after, ROWS_PER_PAGE], idempotent: true });

const COMMITS_OF_BRANCH = `SELECT DISTINCT c.sha AS git_sha FROM render_batches r JOIN commits c ON c.key = r.commit_key
WHERE r.branch = ?1 AND r.environment_key = ${environmentKey("?2")} AND r.started_at BETWEEN CAST(?3 AS INTEGER) AND CAST(?4 AS INTEGER)`;

const COUNT_RENDERS = `SELECT COUNT(*) AS total FROM renders
WHERE batch_key = ${BATCH_KEY}`;

/** A statement's rows as `v`, from one JSON parameter, which holds any number of them and can say null, as a bound one can't. */
const jsonRows = (parameter: string, columns: readonly string[]) => `v(${columns.join(", ")}) AS (
  SELECT ${columns.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ")}
  FROM json_each(${parameter})
)`;

// A row with a hash the images table lacks, or a finished batch, matches nothing, so the
// statement returns too few rows, which is how `recordRenders` knows.
const RECORD_RENDERS = `WITH ${jsonRows("?2", ["story", "image_hash", "failure", "viewport_width", "viewport_height"])}
INSERT INTO renders(batch_key, story_key, image_key, failure, viewport_width, viewport_height)
SELECT r.key, s.key, i.key, v.failure, v.viewport_width, v.viewport_height
FROM render_batches r CROSS JOIN v CROSS JOIN stories s ON s.id = v.story LEFT JOIN images i ON i.hash = v.image_hash
WHERE r.id = ?1 AND r.finished_at IS NULL AND (v.image_hash IS NULL OR i.key IS NOT NULL)
ON CONFLICT(batch_key, story_key) DO UPDATE SET
  image_key = excluded.image_key, failure = excluded.failure,
  viewport_width = excluded.viewport_width, viewport_height = excluded.viewport_height
RETURNING 1 AS written`;

// A decision with no image is on a story being gone, which is held as an image key of 0.
const UPSERT_DECISION = `WITH ${jsonRows("?2", ["story", "image_hash", "sha", "rejected", "decided_at", "actor", "batch_id"])}
INSERT INTO decisions(environment_key, commit_key, story_key, image_key, rejected, decided_at, actor_key, batch_id)
SELECT ${environmentKey("?1")}, c.key, s.key, COALESCE(i.key, 0), v.rejected, v.decided_at, a.key, v.batch_id
FROM v
CROSS JOIN commits c ON c.sha = v.sha
CROSS JOIN stories s ON s.id = v.story
CROSS JOIN actors a ON a.name = v.actor
LEFT JOIN images i ON i.hash = v.image_hash
WHERE true
ON CONFLICT(environment_key, commit_key, story_key, image_key) DO UPDATE SET
  rejected = excluded.rejected, decided_at = excluded.decided_at, actor_key = excluded.actor_key, batch_id = excluded.batch_id`;
const MERGE_DECISION = `${UPSERT_DECISION}
WHERE (excluded.decided_at, excluded.rejected) > (decisions.decided_at, decisions.rejected)`;

const NAME_COLUMNS = { environments: "id", stories: "id", commits: "sha", actors: "name" } as const;

/** Gives these their keys, if they have none. Safe to send again, and writes nothing for a name already here. */
function nameStatements(table: keyof typeof NAME_COLUMNS, names: readonly string[]): SqlStatement[] {
  const column = NAME_COLUMNS[table];
  return chunks([...new Set(names)], NAMES_PER_STATEMENT).map((group) => ({
    sql: `INSERT INTO ${table}(${column}) SELECT value FROM json_each(?1) WHERE true ON CONFLICT(${column}) DO NOTHING`,
    params: [JSON.stringify(group)],
    idempotent: true,
  }));
}

/** A window to lay a story out in, in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * What a batch recorded for one story: the stored image's hash, why it failed, or both, for a story
 * that rendered and then failed, such as by its play function throwing.
 */
export type RecordedRender = {
  /** The story ID, with any render variant in it. Opaque here. */
  readonly story: string;
  /** The window it laid out in, only if that isn't its batch's. */
  readonly viewport?: Viewport | undefined;
} & (
  | { readonly imageHash: string; readonly failure?: string | undefined }
  | { readonly failure: string; readonly imageHash?: undefined }
);

/**
 * - `recording`: not finished. It is still being written, or its writer crashed, so it
 *   may lack renders. After a crash, start a new batch.
 * - `complete`: finished, and every story rendered.
 * - `failed`: finished, and at least one story failed to render.
 */
export type BatchStatus = "recording" | "complete" | "failed";

/** The `--story` patterns that limited a batch, and those that matched nothing. */
export interface StoryFilter {
  readonly patterns: readonly string[];
  readonly unmatched: readonly string[];
}

export interface RenderBatch {
  readonly id: string;
  readonly gitSha: string;
  readonly environment: string;
  readonly status: BatchStatus;
  readonly startedAt: number;
  /** Null until finished, as is `failedCount`. */
  readonly finishedAt: number | null;
  readonly failedCount: number | null;
  /** The working tree had changes, so the images may not describe `gitSha`. Never accepted. */
  readonly dirty: boolean;
  /** Null if every story was asked for. */
  readonly storyFilter: StoryFilter | null;
  /**
   * The batch that really rendered these images, or null if this one did. An ID only: it says where
   * the pixels came from, and `gitSha` still says what the batch was recorded against.
   */
  readonly reusedFromBatch: string | null;
  /** Image pixels per CSS pixel, which the environment's ID hides inside its hash. */
  readonly scale: number;
  /** The window a story lays out in, unless it declares its own, which the environment's ID also hides. */
  readonly viewport: Viewport;
  /** What HEAD was on, which keeps a branch's batches together when a rebase leaves their commits behind. Null if detached. */
  readonly branch: string | null;
}

export type DecisionKind = "approved" | "rejected";

export interface Decision {
  readonly decision: DecisionKind;
  readonly actor: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

export type RenderState = "unchanged" | "changed" | "added" | "removed" | "failed";

/** Whether a render in this state can take a decision: on its image, or on a story being gone. */
export const isDecidable = (state: RenderState): boolean => state === "changed" || state === "added" || state === "removed";

export interface ComparedRender {
  readonly story: string;
  readonly state: RenderState;
  /** The batch's image. Null if `removed`, and if `failed` with nothing rendered. */
  readonly imageHash: string | null;
  /** The baseline's image. Null if `added`, and if `failed` with no golden for this name. */
  readonly goldenHash: string | null;
  /** The batch whose approval made `goldenHash` the reference, when it came from approvals. */
  readonly goldenBatchId?: string;
  /** Why it failed, or null unless `failed`. */
  readonly failure: string | null;
  /** The decision on exactly `imageHash` for this name, if there is one. */
  readonly decision: Decision | null;
}

/** What a batch's history has approved since its base, which reads as unchanged against what's approved now. */
export interface ApprovedSince {
  /** The default branch's batch it's told apart from, or null if its commit reaches none, and then every approval counts. */
  readonly base: RenderBatch | null;
  /** Each as the base would compare it, so `goldenHash` is what it replaced, and with the batch it was approved on. */
  readonly renders: readonly (ComparedRender & { readonly approvedIn: string })[];
}

export interface Comparison {
  readonly batch: RenderBatch;
  /**
   * In name order, the batch's differences from the baseline and anything failed, then
   * the removed renders. Other unchanged ones only if asked for.
   */
  readonly renders: readonly ComparedRender[];
  /** How many of the batch's renders are `unchanged`, whether listed or not. */
  readonly unchangedCount: number;
}

export interface CompareOptions {
  /** List every unchanged render too. Reads and returns far more. */
  readonly includeUnchanged?: boolean;
}

export interface DecisionRequest {
  /** With each render's story, this is its name. */
  readonly environment: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  /** No image means approving that the story is gone. */
  readonly renders: readonly { readonly story: string; readonly imageHash: string | null }[];
  /** The batch this was decided on, and so the commit it counts from. */
  readonly on: { readonly batchId: string; readonly gitSha: string };
}

/** A decision with where it was made, as history reads it. */
export interface PlacedDecision extends Decision {
  readonly story: string;
  /** Null for a removal. */
  readonly imageHash: string | null;
  readonly batchId: string;
  /** The commit it counts from. */
  readonly gitSha: string;
}

/** A batch as another store holds it, which keeps its identity and its times here. */
export type ReceivedBatch = Omit<RenderBatch, "status" | "finishedAt" | "failedCount" | "branch"> & { readonly branch?: string | null };

/** What a batch holds, as a page of a read by name. */
export interface BatchPage {
  readonly batch: RenderBatch;
  readonly renders: readonly RecordedRender[];
  /** Where the next page starts, or null if this is the last. */
  readonly next: string | null;
}

export type BatchErrorCode =
  | "unknown-batch"
  /** The batch takes no more renders, since it was finished. */
  | "batch-finished"
  /** The batch is still `recording`, so it can't be compared. */
  | "batch-not-finished"
  /** Finishing was asked for with a different count than the batch holds. */
  | "wrong-render-count"
  /** A render named an image that isn't stored. */
  | "unknown-image"
  /** A batch with this ID is already here, and it isn't this one. */
  | "batch-conflict"
  | "no-baseline-batch";

/** The request can't apply to the data as it stands. */
export class BatchError extends Error {
  override readonly name = "BatchError";
  readonly code: BatchErrorCode;

  constructor(code: BatchErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RenderBatchesPlumbing {
  readonly sql: Sql;
  /** Defaults to `Date.now`. Tests inject one to control time. */
  readonly now?: () => number;
}

/**
 * Render batches, comparisons, and decisions, over `Sql` alone. Every statement is safe
 * to resend, and nothing relies on a set of statements being atomic. See `docs/specs/renders.md`.
 */
export class RenderBatches {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor({ sql, now = Date.now }: RenderBatchesPlumbing) {
    this.#sql = sql;
    this.#now = now;
  }

  /** Starts a batch, which stays `recording` until `finishBatch`. */
  async beginBatch(options: {
    gitSha: string;
    environment: string;
    scale: number;
    viewport: Viewport;
    dirty: boolean;
    storyFilter?: StoryFilter | null;
    reusedFromBatch?: string | null;
    branch?: string | null;
  }): Promise<RenderBatch> {
    const batch: ReceivedBatch & { branch: string | null } = { storyFilter: null, reusedFromBatch: null, branch: null, ...options, id: crypto.randomUUID(), startedAt: this.#now() };
    await this.#sql.batch(insertBatchStatements(batch));
    return { ...batch, status: "recording", finishedAt: null, failedCount: null };
  }

  /**
   * Starts holding a batch that began in another store, under its own ID and times. If it's
   * already here, this says how far it got, so a resend can carry on: an unfinished one
   * takes its renders again, and a finished one needs nothing. Throws if that ID is here
   * for different facts, since a batch never changes.
   */
  async receiveBatch(received: ReceivedBatch): Promise<RenderBatch> {
    const rows = await this.#sql.batch([...insertBatchStatements(received), { sql: SELECT_BATCH, params: [received.id], idempotent: true }]);
    const batch = toBatch(rows.at(-1)![0]!);
    const { gitSha, environment, startedAt, dirty, scale, viewport } = received;
    if (batch.gitSha !== gitSha || batch.environment !== environment || batch.startedAt !== startedAt || batch.dirty !== dirty || batch.scale !== scale || batch.viewport.width !== viewport.width || batch.viewport.height !== viewport.height) {
      throw new BatchError("batch-conflict", `Batch ${received.id} is already here, and it isn't this one`);
    }
    return batch;
  }

  /**
   * Adds renders to a `recording` batch. A failure can leave any of them written, so
   * after one, send them again: a name the batch already holds takes the newer result.
   * Each image must already be stored, by `Store.putImages`.
   */
  async recordRenders(batchId: string, renders: readonly RecordedRender[]): Promise<void> {
    const statements = recordStatements(batchId, renders);
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) {
      const results = await this.#sql.batch(group.map(({ statement }) => statement));
      const written = results.reduce((sum, rows) => sum + rows.length, 0);
      const sent = group.reduce((sum, { rows }) => sum + rows, 0);
      if (written < sent) await this.#explainUnrecorded(batchId, sent - written);
    }
  }

  async #explainUnrecorded(batchId: string, missing: number): Promise<never> {
    const batch = await this.getBatch(batchId);
    if (batch === null) throw new BatchError("unknown-batch", `No batch ${batchId}`);
    if (batch.status !== "recording") {
      throw new BatchError("batch-finished", `Batch ${batchId} is finished and takes no more renders`);
    }
    throw new BatchError(
      "unknown-image",
      `${missing} renders were not recorded, since their images are not stored`,
    );
  }

  /** Those of a batch's stories that laid out in a window other than the batch's. */
  async storyViewportsOf(batchId: string): Promise<Readonly<Record<string, Viewport>>> {
    const rows = await this.#sql.run({
      sql: `SELECT s.id AS story, rs.viewport_width, rs.viewport_height
FROM render_batches r CROSS JOIN renders rs ON rs.batch_key = r.key JOIN stories s ON s.key = rs.story_key
WHERE r.id = ?1 AND rs.viewport_width IS NOT NULL`,
      params: [batchId],
      idempotent: true,
    });
    return Object.fromEntries(rows.map((row) => [row.story as string, viewportOf(row)]));
  }

  /**
   * Ends a batch, if it holds exactly `expectedCount` renders, failed ones included.
   * If not it stays `recording` and this throws, so statements that were lost show here.
   * A batch from another store gives the time it finished there.
   */
  async finishBatch(batchId: string, expectedCount: number, finishedAt: number = this.#now()): Promise<RenderBatch> {
    const [row] = await this.#sql.run({
      sql: FINISH_BATCH,
      params: [batchId, finishedAt, expectedCount],
      idempotent: true,
    });
    if (row !== undefined) return toBatch(row);

    const [batchRows, countRows] = await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: COUNT_RENDERS, params: [batchId], idempotent: true },
    ]);
    if (batchRows?.[0] === undefined) throw new BatchError("unknown-batch", `No batch ${batchId}`);
    throw new BatchError(
      "wrong-render-count",
      `Batch ${batchId} holds ${String(countRows?.[0]?.total)} renders, not the ${expectedCount} expected`,
    );
  }

  async getBatch(batchId: string): Promise<RenderBatch | null> {
    const [row] = await this.#sql.run({ sql: SELECT_BATCH, params: [batchId], idempotent: true });
    return row === undefined ? null : toBatch(row);
  }

  /** Every batch of this SHA in this environment, newest first, reruns and crashed ones included. */
  async batchesAt(gitSha: string, environment: string): Promise<RenderBatch[]> {
    assertGitSha(gitSha);
    const rows = await this.#sql.run({
      sql: `SELECT ${BATCH_COLUMNS} FROM render_batches
WHERE commit_key = ${commitKey("?1")} AND environment_key = ${environmentKey("?2")}
ORDER BY started_at DESC, key DESC`,
      params: [gitSha, environment],
      idempotent: true,
    });
    return rows.map(toBatch);
  }

  /**
   * Gives a finished batch's renders their states, from image hashes alone, against the images of another
   * finished batch in this environment. Lists only what a reviewer needs unless told otherwise: see `Comparison`.
   */
  async compareWithBatch(batchId: string, baselineBatchId: string, { includeUnchanged = false }: CompareOptions = {}): Promise<Comparison> {
    const comparedPage = (after: string): SqlStatement => ({
      sql: AGAINST_BATCH.comparedPage,
      params: [batchId, baselineBatchId, after, ROWS_PER_PAGE, includeUnchanged ? 1 : 0],
      idempotent: true,
    });
    const removedPage = (after: string): SqlStatement => ({
      sql: AGAINST_BATCH.removedPage,
      params: [batchId, baselineBatchId, after, ROWS_PER_PAGE],
      idempotent: true,
    });

    // One request, which is all a comparison shorter than a page needs.
    const [batchRows, baselineRows, unchangedRows, firstCompared, firstRemoved] =
      (await this.#sql.batch([
        { sql: SELECT_BATCH, params: [batchId], idempotent: true },
        { sql: AGAINST_BATCH.baseline, params: [batchId, baselineBatchId], idempotent: true },
        { sql: AGAINST_BATCH.unchangedCount, params: [batchId, baselineBatchId], idempotent: true },
        comparedPage(START),
        removedPage(START),
      ])) as [SqlRow[], SqlRow[], SqlRow[], SqlRow[], SqlRow[]];

    const batch = finishedBatch(batchRows, batchId);
    if (baselineRows[0]?.batch_key === null) {
      throw new BatchError("no-baseline-batch", `${baselineBatchId} isn't a finished batch in environment ${batch.environment}`);
    }
    const compared = await this.#remainingPages(firstCompared, comparedPage);
    const removed = await this.#remainingPages(firstRemoved, removedPage);
    return {
      batch,
      renders: [...compared.map(toComparedRender).sort(byStory), ...removed.map(toRemovedRender).sort(byStory)],
      unchangedCount: unchangedRows[0]?.total as number,
    };
  }

  /**
   * Compares a batch with these decisions, from `decisionsAt`: for each story, the image of the newest
   * approval among them. Approvals made on this very batch aren't what it's compared with, or a story
   * would read as unchanged the moment someone approved it, but later batches do see them. Taking
   * the decisions lets a caller read them once for many batches. See `docs/specs/renders.md` -> Approvals.
   */
  async compareFromHistory(batchId: string, decisions: readonly PlacedDecision[], options?: CompareOptions): Promise<Comparison> {
    const [batchRows, firstRenders] = (await this.#sql.batch([{ sql: SELECT_BATCH, params: [batchId], idempotent: true }, rendersPage(batchId, START)])) as [SqlRow[], SqlRow[]];
    return this.#withApprovals(batchId, batchRows, firstRenders, decisions, options);
  }

  /** As `compareFromHistory`, with what the batch's commit reaches by `recordCommits`, for a store with no Git to ask. One request, for a batch shorter than a page. */
  async compareReached(batchId: string, options?: CompareOptions): Promise<Comparison> {
    const [batchRows, decisionRows, firstRenders] = (await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: DECISIONS_REACHED, params: [batchId], idempotent: true },
      rendersPage(batchId, START),
    ])) as [SqlRow[], SqlRow[], SqlRow[]];
    return this.#withApprovals(batchId, batchRows, firstRenders, decisionRows.map(toPlacedDecision), options);
  }

  async #withApprovals(batchId: string, batchRows: readonly SqlRow[], firstRenders: readonly SqlRow[], decisions: readonly PlacedDecision[], { includeUnchanged = false }: CompareOptions = {}): Promise<Comparison> {
    const { batch, rendered } = await this.#renderedOf(batchId, batchRows, firstRenders);
    return compareWithApprovals(batch, rendered, decisions, { includeUnchanged });
  }

  async #renderedOf(batchId: string, batchRows: readonly SqlRow[], firstRenders: readonly SqlRow[]): Promise<{ readonly batch: RenderBatch; readonly rendered: readonly RenderedStory[] }> {
    const batch = finishedBatch(batchRows, batchId);
    const rows = await this.#remainingPages(firstRenders, (after) => rendersPage(batchId, after));
    return { batch, rendered: rows.map((row) => ({ story: row.story as string, imageHash: row.image_hash as string | null, failure: row.failure as string | null })).sort(byStory) };
  }

  /**
   * The base a batch is told apart from, as `compareReached` knows it: the newest batch of the default branch
   * its commit reaches, and what was approved as of there. See `docs/specs/renders.md` -> Approved since a base.
   */
  async approvedSinceReached(batchId: string, defaultBranch: string): Promise<ApprovedSince & { readonly current: Comparison }> {
    const [batchRows, decisionRows, baseRows, firstRenders] = (await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: DECISIONS_REACHED, params: [batchId], idempotent: true },
      { sql: BASE_REACHED, params: [batchId, defaultBranch], idempotent: true },
      rendersPage(batchId, START),
    ])) as [SqlRow[], SqlRow[], SqlRow[], SqlRow[]];
    const base = baseRows[0] === undefined ? null : toBatch(baseRows[0]);
    const baseDecisions = base === null ? [] : await this.#sql.run({ sql: DECISIONS_REACHED, params: [base.id], idempotent: true });
    const { batch, rendered } = await this.#renderedOf(batchId, batchRows, firstRenders);
    const decisions = decisionRows.map(toPlacedDecision);
    const current = compareWithApprovals(batch, rendered, decisions);
    return { base, current, renders: approvedSinceBase(current, rendered, decisions, baseDecisions.map(toPlacedDecision)) };
  }

  /** The newest batch of a branch at any of these commits, other than a batch's own, for a store told what's reachable. */
  async baseAmong(branch: string, { environment, gitSha }: Pick<RenderBatch, "environment" | "gitSha">, commits: readonly string[]): Promise<RenderBatch | null> {
    const [row] = await this.#sql.run({ sql: BASE_AMONG, params: [branch, environment, gitSha, JSON.stringify(commits)], idempotent: true });
    return row === undefined ? null : toBatch(row);
  }

  /** As `approvedSinceReached`, with decisions from `decisionsAt`, for a caller with Git. */
  async approvedSinceFromHistory(batchId: string, decisions: readonly PlacedDecision[], baseDecisions: readonly PlacedDecision[]): Promise<ApprovedSince["renders"]> {
    const [batchRows, firstRenders] = (await this.#sql.batch([{ sql: SELECT_BATCH, params: [batchId], idempotent: true }, rendersPage(batchId, START)])) as [SqlRow[], SqlRow[]];
    const { batch, rendered } = await this.#renderedOf(batchId, batchRows, firstRenders);
    return approvedSinceBase(compareWithApprovals(batch, rendered, decisions), rendered, decisions, baseDecisions);
  }

  /** Every decision made at these commits. One parameter however many, so a long history is one statement. */
  async decisionsAt(environment: string, commits: readonly string[]): Promise<readonly PlacedDecision[]> {
    const rows = await this.#sql.run({ sql: DECISIONS_AT, params: [environment, JSON.stringify(commits)], idempotent: true });
    return rows.map(toPlacedDecision);
  }

  /** Says which commits came before which, for a store with no Git to ask. Sending one again changes nothing. */
  async recordCommits(commits: readonly { readonly sha: string; readonly parents: readonly string[] }[]): Promise<void> {
    for (const { sha, parents } of commits) [sha, ...parents].forEach(assertGitSha);
    const edges = commits.flatMap(({ sha, parents }) => parents.map((parent) => [sha, parent]));
    const statements: SqlStatement[] = [
      ...nameStatements("commits", commits.flatMap(({ sha, parents }) => [sha, ...parents])),
      ...chunks(edges, NAMES_PER_STATEMENT).map((group) => ({
        sql: `INSERT INTO commit_parents(commit_key, parent_key)
SELECT c.key, p.key FROM json_each(?1) j
CROSS JOIN commits c ON c.sha = json_extract(j.value, '$[0]')
CROSS JOIN commits p ON p.sha = json_extract(j.value, '$[1]')
WHERE true ON CONFLICT(commit_key, parent_key) DO NOTHING`,
        params: [JSON.stringify(group)],
        idempotent: true,
      })),
    ];
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /** The newest finished batch here, on this branch if one is given, or null. */
  async newestFinished(branch?: string): Promise<RenderBatch | null> {
    const [row] = await this.#sql.run({
      sql: `SELECT ${BATCH_COLUMNS} FROM render_batches WHERE finished_at IS NOT NULL${branch === undefined ? "" : " AND branch = ?1"} ORDER BY key DESC LIMIT 1`,
      ...(branch === undefined ? {} : { params: [branch] }),
      idempotent: true,
    });
    return row === undefined ? null : toBatch(row);
  }

  /** The commits of a branch's batches between two times, which a rebase may have left out of its history. */
  async commitsOfBranch(branch: string, environment: string, since: number, until: number): Promise<readonly string[]> {
    const rows = await this.#sql.run({ sql: COMMITS_OF_BRANCH, params: [branch, environment, since, until], idempotent: true });
    return rows.map((row) => row.git_sha as string);
  }

  async #remainingPages(
    first: readonly SqlRow[],
    pageAfter: (after: string) => SqlStatement,
  ): Promise<SqlRow[]> {
    const rows = [...first];
    let page = first;
    while (page.length === ROWS_PER_PAGE) {
      page = await this.#sql.run(pageAfter(String(page[page.length - 1]!.story_key)));
      rows.push(...page);
    }
    return rows;
  }

  /**
   * Records a person's or agent's decision on these renders, now, at the commit of the batch it's
   * on. It holds for this name and this image hash, and for no other image. Each name, hash,
   * and commit keeps only its most recent decision.
   */
  async decide({ environment, decision, actor, renders, on }: DecisionRequest): Promise<void> {
    assertNamePart(environment, "environment");
    if (actor === "") throw new RangeError("A decision must say who made it");
    assertGitSha(on.gitSha);
    assertBatchIdShape(on.batchId);
    if (renders.length === 0) return;
    for (const { story, imageHash } of renders) {
      assertNamePart(story, "story");
      if (imageHash !== null) assertImageHash(imageHash);
    }
    const at = this.#now();
    await this.#writeDecisions(environment, renders.map(({ story, imageHash }) => ({ story, imageHash, decision, actor, at, gitSha: on.gitSha, batchId: on.batchId })), UPSERT_DECISION);
  }

  /** A decision names an image held here, as a render does, so that it can hold that image's key. Refuses them all if any isn't. */
  async #writeDecisions(environment: string, decisions: readonly PlacedDecision[], upsert: string): Promise<void> {
    const missing = await missingImages(this.#sql, decisions.flatMap(({ imageHash }) => imageHash ?? []));
    if (missing.length > 0) throw new BatchError("unknown-image", `${missing.length} of these decisions are on images this store doesn't hold, so none were recorded`);
    const statements: SqlStatement[] = [
      ...nameStatements("environments", [environment]),
      ...nameStatements("commits", decisions.map(({ gitSha }) => gitSha)),
      ...nameStatements("actors", decisions.map(({ actor }) => actor)),
      ...nameStatements("stories", decisions.map(({ story }) => story)),
      ...chunks(decisions, DECISIONS_PER_STATEMENT).map((group) => ({
        sql: upsert,
        params: [environment, JSON.stringify(group.map(({ story, imageHash, gitSha, decision, at, actor, batchId }) => [story, imageHash, gitSha, decision === "rejected" ? 1 : 0, at, actor, batchId]))],
        idempotent: true,
      })),
    ];
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /** A page of all a batch holds, for another store to take, in no order but its own. Unlike a comparison, it needs no baseline. */
  async readBatch(batchId: string, after = "", limit = ROWS_PER_PAGE): Promise<BatchPage> {
    const [batchRows, rows] = (await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: READ_BATCH_PAGE, params: [batchId, after, limit + 1], idempotent: true },
    ])) as [SqlRow[], SqlRow[]];
    const batch = finishedBatch(batchRows, batchId);
    const page = rows.slice(0, limit);
    return {
      batch,
      renders: page.map((row) => ({
        story: row.story as string,
        ...(row.viewport_width === null ? {} : { viewport: viewportOf(row) }),
        ...(row.image_hash === null ? { failure: row.failure as string } : { imageHash: row.image_hash as string, ...(row.failure === null ? {} : { failure: row.failure as string }) }),
      })),
      next: rows.length > limit ? String(page.at(-1)!.story_key) : null,
    };
  }

  /**
   * Takes decisions from another store. For one name, hash, and commit the latest wins, and at the
   * same moment a rejection does, so two stores reach one verdict whichever order they hear
   * in. Who made it travels with it, and isn't compared, so sending a decision back to where
   * it came from can't change whose it is. Each must name an image this store holds.
   */
  async mergeDecisions(environment: string, decisions: readonly PlacedDecision[]): Promise<void> {
    assertNamePart(environment, "environment");
    if (decisions.length === 0) return;
    for (const { story, imageHash, actor, gitSha, batchId } of decisions) {
      assertNamePart(story, "story");
      if (imageHash !== null) assertImageHash(imageHash);
      assertGitSha(gitSha);
      assertBatchIdShape(batchId);
      if (actor === "") throw new RangeError("A decision must say who made it");
    }
    await this.#writeDecisions(environment, decisions, MERGE_DECISION);
  }
}

// Before every story, whose key is never 0. A page's end is otherwise only ever a story key, as text.
const START = "";

/** As a comparison lists them, whatever order a story first came to this store in. */
const byStory = (a: { readonly story: string }, b: { readonly story: string }) => (a.story < b.story ? -1 : a.story > b.story ? 1 : 0);

interface RecordStatement {
  readonly statement: SqlStatement;
  /** How many rows it must return, one for each render it wrote. */
  readonly rows: number;
}

function recordStatements(batchId: string, renders: readonly RecordedRender[]): RecordStatement[] {
  const names = new Set<string>();
  for (const { story, imageHash, viewport } of renders) {
    assertNamePart(story, "story");
    if (imageHash !== undefined) assertImageHash(imageHash);
    if (viewport !== undefined) assertViewport(viewport);
    if (names.has(story)) throw new RangeError(`Story recorded twice in one call: ${story}`);
    names.add(story);
  }

  return [
    ...nameStatements("stories", [...names]).map((statement) => ({ statement, rows: 0 })),
    ...chunks(renders, RENDERS_PER_STATEMENT).map((group) => ({
      statement: {
        sql: RECORD_RENDERS,
        params: [batchId, JSON.stringify(group.map(({ story, imageHash, failure, viewport }) => [story, imageHash ?? null, failure === undefined ? null : cleanMessage(failure), viewport?.width ?? null, viewport?.height ?? null]))],
        idempotent: true,
      },
      rows: group.length,
    })),
  ];
}

/** Cut by code point, so a cut never splits a surrogate pair. */
function cleanMessage(message: string): string {
  return Array.from(message.replaceAll("\0", "")).slice(0, MAX_MESSAGE_CHARACTERS).join("");
}

function finishedBatch(rows: readonly SqlRow[], batchId: string): RenderBatch {
  const [row] = rows;
  if (row === undefined) throw new BatchError("unknown-batch", `No batch ${batchId}`);
  const batch = toBatch(row);
  if (batch.status === "recording") {
    throw new BatchError(
      "batch-not-finished",
      `Batch ${batchId} is still recording, so what it lacks can't be told from what was removed`,
    );
  }
  return batch;
}

function assertBatchIdShape(batchId: string): void {
  if (!isBatchId(batchId)) throw new RangeError(`A decision's batch must be a batch ID, got ${JSON.stringify(batchId)}`);
}

const viewportOf = (row: SqlRow): Viewport => ({ width: row.viewport_width as number, height: row.viewport_height as number });

function toBatch(row: SqlRow): RenderBatch {
  const failedCount = row.failed_count as number | null;
  const finishedAt = row.finished_at as number | null;
  return {
    id: row.id as string,
    gitSha: row.git_sha as string,
    environment: row.environment as string,
    status: finishedAt === null ? "recording" : failedCount === 0 ? "complete" : "failed",
    startedAt: row.started_at as number,
    finishedAt,
    failedCount,
    dirty: row.dirty === 1,
    storyFilter: row.story_filter === null ? null : (JSON.parse(row.story_filter as string) as StoryFilter),
    reusedFromBatch: row.reused_from_batch as string | null,
    scale: row.scale as number,
    viewport: viewportOf(row),
    branch: row.branch as string | null,
  };
}

// The same order as `DECISION_ON_RENDER` and the merge rule: latest first, then `rejected` before `approved`.
const toPlacedDecision = (row: SqlRow): PlacedDecision => ({
  story: row.story as string,
  imageHash: row.image_hash as string | null,
  decision: row.decision as DecisionKind,
  actor: row.actor as string,
  at: row.decided_at as number,
  batchId: row.batch_id as string,
  gitSha: row.git_sha as string,
});

const newestFirst = (a: PlacedDecision, b: PlacedDecision) => b.at - a.at || b.decision.localeCompare(a.decision);

/**
 * What another store needs of these decisions to compare the same way: each story's, newest first, back
 * through its second-newest approval. The second, since an approval made on a batch isn't what that batch
 * is compared with. Anything older can't change what a story reads as, so its images needn't be fetched.
 */
export function decisionsThatCount(decisions: readonly PlacedDecision[]): readonly PlacedDecision[] {
  return [...decisionsByStory(decisions).values()].flatMap((list) => {
    let approvals = 0;
    const end = list.findIndex(({ decision }) => decision === "approved" && ++approvals === 2);
    return end === -1 ? list : list.slice(0, end + 1);
  });
}

/** Each story's decisions, newest first. */
function decisionsByStory(decisions: readonly PlacedDecision[]): Map<string, PlacedDecision[]> {
  const byStory = new Map<string, PlacedDecision[]>();
  for (const decision of decisions) {
    const list = byStory.get(decision.story);
    if (list === undefined) byStory.set(decision.story, [decision]);
    else list.push(decision);
  }
  for (const list of byStory.values()) list.sort(newestFirst);
  return byStory;
}

interface RenderedStory {
  readonly story: string;
  readonly imageHash: string | null;
  readonly failure: string | null;
}

/** What a story is compared with: its newest approval, leaving out any made on the batch being compared. */
const newestApproval = (decisionsOf: ReadonlyMap<string, readonly PlacedDecision[]>, story: string, batchId: string) =>
  decisionsOf.get(story)?.find((decision) => decision.decision === "approved" && decision.batchId !== batchId);

/**
 * A batch's renders against the approvals that history reaches. Pure, since this is the rule. A
 * story's reference is the image of its newest approval, leaving out any made on this batch. A
 * decision counts for an image if it's newer than that approval, so an image approved long ago
 * and since replaced asks again if a change brings it back.
 */
export function compareWithApprovals(
  batch: RenderBatch,
  rendered: readonly RenderedStory[],
  decisions: readonly PlacedDecision[],
  { includeUnchanged = false }: CompareOptions = {},
): Comparison {
  const decisionsOf = decisionsByStory(decisions);

  const referenceOf = (story: string) => newestApproval(decisionsOf, story, batch.id);
  /** What's been said about this image since the reference, if anything has. */
  const decisionOn = (story: string, imageHash: string | null, referenceAt: number): Decision | null => {
    const found = decisionsOf.get(story)?.find((decision) => decision.imageHash === imageHash && decision.at >= referenceAt);
    return found === undefined ? null : { decision: found.decision, actor: found.actor, at: found.at };
  };

  const compared: ComparedRender[] = [];
  let unchangedCount = 0;
  for (const { story, imageHash, failure } of rendered) {
    const reference = referenceOf(story);
    const goldenHash = reference?.imageHash ?? null;
    const state = stateOf(imageHash, goldenHash, failure);
    if (state === "unchanged") unchangedCount += 1;
    if (state === "unchanged" && !includeUnchanged) continue;
    compared.push({ story, state, imageHash, goldenHash, ...(goldenHash === null ? {} : { goldenBatchId: reference!.batchId }), failure, decision: state === "failed" ? null : decisionOn(story, imageHash, reference?.at ?? 0) });
  }

  const here = new Set(rendered.map(({ story }) => story));
  const removed: ComparedRender[] = [];
  for (const story of [...decisionsOf.keys()].sort()) {
    if (here.has(story)) continue;
    const reference = referenceOf(story);
    if (reference === undefined || reference.imageHash === null) continue;
    removed.push({ story, state: "removed", imageHash: null, goldenHash: reference.imageHash, goldenBatchId: reference.batchId, failure: null, decision: decisionOn(story, null, reference.at) });
  }
  return { batch, renders: [...compared, ...removed], unchangedCount };
}

/**
 * The stories a batch has nothing to say about now, because of an approval the base doesn't reach. Each is
 * as the base's approvals compare it, which is how a change stays visible once it's what's approved.
 */
export function approvedSinceBase(current: Comparison, rendered: readonly RenderedStory[], decisions: readonly PlacedDecision[], baseDecisions: readonly PlacedDecision[]): ApprovedSince["renders"] {
  const { batch } = current;
  const stillDiffers = new Set(current.renders.map(({ story }) => story));
  const decisionsOf = decisionsByStory(decisions);
  return compareWithApprovals(batch, rendered, baseDecisions).renders.flatMap((render) => {
    const approval = newestApproval(decisionsOf, render.story, batch.id);
    if (stillDiffers.has(render.story) || approval === undefined) return [];
    const { decision, actor, at, batchId: approvedIn } = approval;
    return [{ ...render, decision: { decision, actor, at }, approvedIn }];
  });
}

const stateOf = (imageHash: string | null, goldenHash: string | null, failure: string | null): RenderState =>
  failure !== null || imageHash === null ? "failed" : goldenHash === null ? "added" : imageHash === goldenHash ? "unchanged" : "changed";

function toComparedRender(row: SqlRow): ComparedRender {
  const imageHash = row.image_hash as string | null;
  const goldenHash = row.golden_hash as string | null;
  const failure = row.failure as string | null;
  const state = stateOf(imageHash, goldenHash, failure);
  return {
    story: row.story as string,
    state,
    imageHash,
    goldenHash,
    failure,
    decision:
      row.decision === null || state === "failed"
        ? null
        : {
            decision: row.decision as DecisionKind,
            actor: row.actor as string,
            at: row.decided_at as number,
          },
  };
}

function toRemovedRender(row: SqlRow): ComparedRender {
  return {
    story: row.story as string,
    state: "removed",
    imageHash: null,
    goldenHash: row.golden_hash as string,
    failure: null,
    decision: null,
  };
}

function assertGitSha(gitSha: string): void {
  if (!GIT_SHA.test(gitSha)) {
    throw new RangeError(`Not a full lowercase Git SHA: ${JSON.stringify(gitSha)}`);
  }
}

// NUL is refused because stores needn't agree on where such a string ends.
function assertNamePart(part: string, what: string): void {
  if (part === "" || part.includes("\0")) {
    throw new RangeError(`A render's ${what} must be non-empty with no NUL: ${JSON.stringify(part)}`);
  }
}

export function assertViewport({ width, height }: Viewport): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new RangeError(`A viewport must be positive whole numbers, got ${width}x${height}`);
}

function insertBatchStatements({ id, gitSha, environment, startedAt, dirty, storyFilter, reusedFromBatch, scale, viewport, branch }: ReceivedBatch): SqlStatement[] {
  assertGitSha(gitSha);
  assertNamePart(environment, "environment");
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`A batch's scale must be a positive number, got ${scale}`);
  assertViewport(viewport);
  return [
    ...nameStatements("commits", [gitSha]),
    ...nameStatements("environments", [environment]),
    {
      // Sql binds no nulls, so an empty string stands for one.
      sql: `INSERT INTO render_batches(id, commit_key, environment_key, started_at, dirty, story_filter, reused_from_batch, scale, branch, viewport_width, viewport_height)
VALUES (?1, ${commitKey("?2")}, ${environmentKey("?3")}, CAST(?4 AS INTEGER), CAST(?5 AS INTEGER), NULLIF(?6, ''), NULLIF(?7, ''), ?8, NULLIF(?9, ''), CAST(?10 AS INTEGER), CAST(?11 AS INTEGER))
ON CONFLICT(id) DO NOTHING`,
      params: [id, gitSha, environment, startedAt, dirty ? 1 : 0, storyFilter === null ? "" : JSON.stringify(storyFilter), reusedFromBatch ?? "", scale, branch ?? "", viewport.width, viewport.height],
      idempotent: true,
    },
  ];
}

/** A story's newest render across some batches, and the batch it's from. */
export interface StoryRender<BatchLike> {
  readonly batch: BatchLike;
  readonly row: ComparedRender;
}

/**
 * Each story's newest render, across batches given newest first, reading only until each of `stories`
 * has one, since a comparison isn't free, and most batches at a commit are partial. With no `stories`,
 * it reads them all. A batch that left a story out reads as having removed it, which says nothing about
 * that story, so it's taken from an older batch.
 */
export async function newestRenders<BatchLike>(
  batches: readonly BatchLike[],
  rowsOf: (batch: BatchLike) => Promise<readonly ComparedRender[]>,
  stories?: ReadonlySet<string>,
): Promise<Map<string, StoryRender<BatchLike>>> {
  const renders = new Map<string, StoryRender<BatchLike>>();
  const wanted = stories?.size ?? Number.POSITIVE_INFINITY;
  let found = 0;
  for (const batch of batches) {
    if (found >= wanted) break;
    for (const row of await rowsOf(batch)) {
      if (row.state === "removed" || renders.has(row.story) || (stories !== undefined && !stories.has(row.story))) continue;
      renders.set(row.story, { batch, row });
      found += 1;
    }
  }
  return renders;
}
