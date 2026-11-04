import { chunks, STATEMENTS_PER_REQUEST } from "./chunks.ts";
import { assertImageHash } from "./image-hash.ts";
import type { Sql, SqlParam, SqlRow, SqlStatement } from "./sql.ts";

/**
 * The tables behind `RenderBatches`, which `initStoreSchema` creates. Rows hold the image
 * key and the batch key for compactness, and both stay private to this store: everything
 * this module takes or returns names an image by its hash and a batch by its `id`.
 */
export const CREATE_BATCH_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS render_batches (
  key INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  git_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  failed_count INTEGER,
  dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
  story_filter TEXT,
  reused_from_batch TEXT,
  scale REAL NOT NULL,
  branch TEXT
)`,
  "CREATE INDEX IF NOT EXISTS batches_by_sha ON render_batches(git_sha, environment, started_at)",
  "CREATE INDEX IF NOT EXISTS batches_by_branch ON render_batches(branch, environment, started_at)",
  `CREATE TABLE IF NOT EXISTS renders (
  batch_key INTEGER NOT NULL,
  story TEXT NOT NULL,
  image_key INTEGER,
  failure TEXT,
  play_error TEXT,
  PRIMARY KEY (batch_key, story),
  CHECK ((image_key IS NULL) <> (failure IS NULL))
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS decisions (
  environment TEXT NOT NULL,
  story TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  actor TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  git_sha TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  PRIMARY KEY (environment, story, image_hash, git_sha)
) WITHOUT ROWID`,
  "CREATE INDEX IF NOT EXISTS decisions_by_commit ON decisions(environment, git_sha)",
  `CREATE TABLE IF NOT EXISTS goldens (
  git_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  batch_key INTEGER NOT NULL,
  PRIMARY KEY (git_sha, environment)
) WITHOUT ROWID`,
];

// These fit the limit of 100 bound parameters per statement, beside what all of a
// statement's rows share. A recorded render takes two, or three with a play error,
// so a statement holds 49 when none has one, and at least 33.
const MAX_RECORD_PARAMS = 100;
const RENDERS_PER_DECISION_STATEMENT = 47;
// Beside the environment, a merged decision takes seven.
const DECISIONS_PER_MERGE_STATEMENT = 14;
// Nearest first, beside the environment.
const SHAS_PER_GOLDENS_QUERY = 99;

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

const BATCH_COLUMNS =
  "id, git_sha, environment, started_at, finished_at, failed_count, dirty, story_filter, reused_from_batch, scale, branch";

const SELECT_BATCH = `SELECT ${BATCH_COLUMNS} FROM render_batches WHERE id = ?1`;

// The key of the batch holding a baseline's goldens, only ever in the batch's own
// environment. Uncorrelated, so SQLite evaluates it once. An empty ?2 means no baseline.
const GOLDENS_BATCH_KEY = `(SELECT g.batch_key FROM goldens g
  WHERE g.git_sha = ?2 AND g.environment = (SELECT environment FROM render_batches WHERE id = ?1))`;

// The key of a finished batch named by ?2, only ever in the batch's own environment.
const NAMED_BATCH_KEY = `(SELECT b.key FROM render_batches b
  WHERE b.id = ?2 AND b.finished_at IS NOT NULL
    AND b.environment = (SELECT environment FROM render_batches WHERE id = ?1))`;

// A name and hash can have a decision per commit. What reads one without history in hand wants the
// newest, latest first, and at the same moment a rejection, then by commit so that one row wins.
const NEWEST_DECISION = `NOT EXISTS (SELECT 1 FROM decisions n
    WHERE n.environment = d.environment AND n.story = d.story AND n.image_hash = d.image_hash
      AND (n.decided_at, d.decision, n.git_sha) > (d.decided_at, n.decision, d.git_sha))`;

/** A comparison's statements, against whichever batch a key expression finds. */
const comparisonStatements = (baselineKey: string) => ({
  baseline: `SELECT ${baselineKey} AS batch_key`,
  // `gs` joins before the images so that a row left out never reads them.
  comparedPage: `SELECT rs.story, i.hash AS image_hash, rs.failure, rs.play_error,
  gi.hash AS golden_hash, d.decision, d.actor, d.decided_at
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN renders gs ON gs.batch_key = ${baselineKey} AND gs.story = rs.story
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN images gi ON gi.key = gs.image_key
LEFT JOIN decisions d ON d.environment = r.environment AND d.story = rs.story
  AND d.image_hash = i.hash AND ${NEWEST_DECISION}
WHERE r.id = ?1 AND rs.story > ?3
  AND (CAST(?5 AS INTEGER) = 1 OR rs.image_key IS NULL
    OR rs.image_key IS NOT gs.image_key OR rs.play_error IS NOT NULL)
ORDER BY rs.story
LIMIT CAST(?4 AS INTEGER)`,
  removedPage: `SELECT gs.story, gi.hash AS golden_hash
FROM renders gs
JOIN images gi ON gi.key = gs.image_key
WHERE gs.batch_key = ${baselineKey} AND gs.story > ?3
  AND NOT EXISTS (SELECT 1 FROM renders rs
    WHERE rs.batch_key = (SELECT key FROM render_batches WHERE id = ?1) AND rs.story = gs.story)
ORDER BY gs.story
LIMIT CAST(?4 AS INTEGER)`,
  unchangedCount: `SELECT COUNT(*) AS total
FROM renders rs
JOIN renders gs ON gs.batch_key = ${baselineKey} AND gs.story = rs.story
WHERE rs.batch_key = (SELECT key FROM render_batches WHERE id = ?1) AND rs.image_key = gs.image_key`,
});

const AGAINST_GOLDENS = comparisonStatements(GOLDENS_BATCH_KEY);
const AGAINST_BATCH = comparisonStatements(NAMED_BATCH_KEY);

const COUNT_REMOVED = `(SELECT COUNT(*) FROM renders gs
  WHERE gs.batch_key = ${GOLDENS_BATCH_KEY}
    AND NOT EXISTS (SELECT 1 FROM renders rs
      WHERE rs.batch_key = (SELECT key FROM render_batches WHERE id = ?1) AND rs.story = gs.story))`;

const SELECT_REMOVED_COUNT = `SELECT ${COUNT_REMOVED} AS total`;

const CAN_BE_GOLDENS = "r.finished_at IS NOT NULL AND r.failed_count = 0 AND r.dirty = 0";

// The checks and the write are one statement, so nothing can change between them, and
// the goldens of a SHA appear whole. Sent again, it must still succeed, so a batch already
// accepted passes without the checks: accepting a rerun over its own SHA's goldens makes
// the baseline itself, and then nothing reads as removed.
const ACCEPT_BATCH = `INSERT INTO goldens(git_sha, environment, batch_key)
SELECT r.git_sha, r.environment, r.key
FROM render_batches r
WHERE r.id = ?1 AND ${CAN_BE_GOLDENS}
  AND (?2 = '' OR ${GOLDENS_BATCH_KEY} IS NOT NULL)
  AND (
    EXISTS (SELECT 1 FROM goldens a
      WHERE a.git_sha = r.git_sha AND a.environment = r.environment AND a.batch_key = r.key)
    OR (
      ${COUNT_REMOVED} = CAST(?3 AS INTEGER)
      AND NOT EXISTS (
        SELECT 1 FROM renders rs
        LEFT JOIN renders gs ON gs.batch_key = ${GOLDENS_BATCH_KEY} AND gs.story = rs.story
        WHERE rs.batch_key = r.key AND gs.image_key IS NOT rs.image_key
          AND NOT EXISTS (
            SELECT 1 FROM decisions d
            WHERE d.environment = r.environment AND d.story = rs.story
              AND d.decision = 'approved'
              AND d.image_hash = (SELECT hash FROM images WHERE key = rs.image_key)
          )
      )
    )
  )
ON CONFLICT(git_sha, environment) DO UPDATE SET batch_key = excluded.batch_key
RETURNING batch_key`;

// Counted in the statement that marks the batch, so statements that never landed can't be
// marked finished. Running it again changes nothing, since a finished batch takes no rows.
const FINISH_BATCH = `UPDATE render_batches SET
  finished_at = COALESCE(finished_at, CAST(?2 AS INTEGER)),
  failed_count = c.failed
FROM (
  SELECT COUNT(*) AS total, COALESCE(SUM(image_key IS NULL), 0) AS failed
  FROM renders
  WHERE batch_key = (SELECT key FROM render_batches WHERE id = ?1)
) AS c
WHERE render_batches.id = ?1 AND c.total = CAST(?3 AS INTEGER)
RETURNING ${BATCH_COLUMNS}`;

// Not by the checks that accepting makes, since another store already made them.
const ADOPT_GOLDENS = `INSERT INTO goldens(git_sha, environment, batch_key)
SELECT r.git_sha, r.environment, r.key FROM render_batches r
WHERE r.id = ?1 AND ${CAN_BE_GOLDENS}
ON CONFLICT(git_sha, environment) DO UPDATE SET batch_key = excluded.batch_key
RETURNING batch_key`;

const BATCH_PAGE_TAIL = `WHERE r.id = ?1 AND rs.story > ?2
ORDER BY rs.story
LIMIT CAST(?3 AS INTEGER)`;

const READ_BATCH_PAGE = `SELECT rs.story, i.hash AS image_hash, rs.failure, rs.play_error, d.decision, d.actor, d.decided_at, d.git_sha, d.batch_id
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN decisions d ON d.environment = r.environment AND d.story = rs.story AND d.image_hash = i.hash AND ${NEWEST_DECISION}
${BATCH_PAGE_TAIL}`;

// What a story's image hash is when a decision is on it being gone.
const REMOVAL = "";

const READ_RENDERS_PAGE = `SELECT rs.story, i.hash AS image_hash, rs.failure, rs.play_error
FROM render_batches r
CROSS JOIN renders rs ON rs.batch_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
${BATCH_PAGE_TAIL}`;

const DECISIONS_AT = `SELECT story, image_hash, decision, actor, decided_at, batch_id FROM decisions
WHERE environment = ?1 AND git_sha IN (SELECT value FROM json_each(?2))`;

const COMMITS_OF_BRANCH = `SELECT DISTINCT git_sha FROM render_batches
WHERE branch = ?1 AND environment = ?2 AND started_at BETWEEN CAST(?3 AS INTEGER) AND CAST(?4 AS INTEGER)`;

const COUNT_RENDERS = `SELECT COUNT(*) AS total FROM renders
WHERE batch_key = (SELECT key FROM render_batches WHERE id = ?1)`;

// A row with a hash the images table lacks, or a finished batch, matches nothing, so the
// statement returns too few rows, which is how `recordRenders` knows.
const recordSql = (values: string) =>
  `WITH v(story, image_hash, failure, play_error) AS (VALUES ${values})
INSERT INTO renders(batch_key, story, image_key, failure, play_error)
SELECT r.key, v.story, i.key, v.failure, v.play_error
FROM render_batches r CROSS JOIN v LEFT JOIN images i ON i.hash = v.image_hash
WHERE r.id = ?1 AND r.finished_at IS NULL AND (v.image_hash IS NULL OR i.key IS NOT NULL)
ON CONFLICT(batch_key, story) DO UPDATE SET
  image_key = excluded.image_key, failure = excluded.failure,
  play_error = excluded.play_error
RETURNING 1 AS written`;

/**
 * What a batch recorded for one story: the stored image's hash, or why it failed.
 * `playError` says why its play function failed, on a story that may still have rendered.
 */
export type RecordedRender = {
  /** The story ID, with any render variant in it. Opaque here. */
  readonly story: string;
  readonly playError?: string | null;
} & (
  | { readonly imageHash: string; readonly failure?: undefined }
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
  /** The batch's image. Null if `removed` or `failed`. */
  readonly imageHash: string | null;
  /** The baseline's image. Null if `added`, and if `failed` with no golden for this name. */
  readonly goldenHash: string | null;
  /** The batch whose approval made `goldenHash` the reference, when it came from approvals. */
  readonly goldenBatchId?: string;
  /** Null unless `failed`. */
  readonly failure: string | null;
  /** As recorded: null if there was none, and always null if `removed`. */
  readonly playError: string | null;
  /** The decision on exactly `imageHash` for this name, if there is one. */
  readonly decision: Decision | null;
}

export interface Comparison {
  readonly batch: RenderBatch;
  /**
   * In name order, the batch's differences from the baseline and anything with a play
   * error, then the removed renders. Other unchanged ones only if asked for.
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
}

/** A batch as another store holds it, which keeps its identity and its times here. */
export type ReceivedBatch = Omit<RenderBatch, "status" | "finishedAt" | "failedCount" | "branch"> & { readonly branch?: string | null };

/** A decision with the batch it was made on, and the commit it counts from. */
export interface DecisionOn extends Decision {
  readonly gitSha: string;
  readonly batchId: string;
}

/** A decision as another store holds it, which keeps its time and its commit here. */
export interface ReceivedDecision extends DecisionOn {
  readonly story: string;
  readonly imageHash: string;
}

/** What a batch holds, as a page of a read by name. */
export interface BatchPage {
  readonly batch: RenderBatch;
  readonly renders: readonly (RecordedRender & { readonly decision: DecisionOn | null })[];
  /** Where the next page starts, or null if this is the last. */
  readonly next: string | null;
}

export type BatchErrorCode =
  | "unknown-batch"
  /** The batch takes no more renders, since it was finished. */
  | "batch-finished"
  /** The batch is still `recording`, so it can't be compared or accepted. */
  | "batch-not-finished"
  /** The batch is `failed`, so it can't become goldens. */
  | "batch-has-failures"
  /** The batch was recorded on a dirty tree, so it can't become goldens. */
  | "batch-dirty"
  /** Finishing was asked for with a different count than the batch holds. */
  | "wrong-render-count"
  /** Accepting was asked for with a different count of removed renders than there are. */
  | "wrong-removed-count"
  /** A render named an image that isn't stored. */
  | "unknown-image"
  /** A batch with this ID is already here, and it isn't this one. */
  | "batch-conflict"
  /** The baseline SHA has no goldens in the batch's environment. */
  | "no-goldens"
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
 * Render batches, comparisons, decisions, and goldens, over `Sql` alone. Every statement is safe
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
    dirty: boolean;
    storyFilter?: StoryFilter | null;
    reusedFromBatch?: string | null;
    branch?: string | null;
  }): Promise<RenderBatch> {
    const batch: ReceivedBatch & { branch: string | null } = { storyFilter: null, reusedFromBatch: null, branch: null, ...options, id: crypto.randomUUID(), startedAt: this.#now() };
    await this.#sql.run(insertBatchStatement(batch));
    return { ...batch, status: "recording", finishedAt: null, failedCount: null };
  }

  /**
   * Starts holding a batch that began in another store, under its own ID and times. If it's
   * already here, this says how far it got, so a resend can carry on: an unfinished one
   * takes its renders again, and a finished one needs nothing. Throws if that ID is here
   * for different facts, since a batch never changes.
   */
  async receiveBatch(received: ReceivedBatch): Promise<RenderBatch> {
    const [, rows] = await this.#sql.batch([insertBatchStatement(received), { sql: SELECT_BATCH, params: [received.id], idempotent: true }]);
    const batch = toBatch(rows![0]!);
    const { gitSha, environment, startedAt, dirty, scale } = received;
    if (batch.gitSha !== gitSha || batch.environment !== environment || batch.startedAt !== startedAt || batch.dirty !== dirty || batch.scale !== scale) {
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
WHERE git_sha = ?1 AND environment = ?2
ORDER BY started_at DESC, key DESC`,
      params: [gitSha, environment],
      idempotent: true,
    });
    return rows.map(toBatch);
  }

  /**
   * Gives a finished batch's renders their states, from image hashes alone, against the
   * goldens of `baselineSha` in the batch's own environment. A null baseline means there
   * are none yet, so every render with an image is `added`. Lists only what a reviewer needs
   * unless told otherwise: see `Comparison`.
   */
  async compareBatch(batchId: string, baselineSha: string | null, options?: CompareOptions): Promise<Comparison> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    return this.#compare(batchId, baselineSha ?? "", AGAINST_GOLDENS, options, (found, batch) =>
      assertGoldensFound(baselineSha, found, batch),
    );
  }

  /** As `compareBatch`, with the images of another finished batch in this environment standing in for goldens. */
  async compareWithBatch(batchId: string, baselineBatchId: string, options?: CompareOptions): Promise<Comparison> {
    return this.#compare(batchId, baselineBatchId, AGAINST_BATCH, options, (found, batch) => {
      if (!found) {
        throw new BatchError("no-baseline-batch", `${baselineBatchId} isn't a finished batch in environment ${batch.environment}`);
      }
    });
  }

  /**
   * Compares a batch with these decisions, from `decisionsAt`: for each story, the image of the newest
   * approval among them. Approvals made on this very batch aren't what it's compared with, or a story
   * would read as unchanged the moment someone approved it, but later batches do see them. Taking
   * the decisions lets a caller read them once for many batches. See `docs/specs/renders.md` -> Approvals.
   */
  async compareFromHistory(batchId: string, decisions: readonly PlacedDecision[], { includeUnchanged = false }: CompareOptions = {}): Promise<Comparison> {
    const rendersPage = (after: string): SqlStatement => ({ sql: READ_RENDERS_PAGE, params: [batchId, after, ROWS_PER_PAGE], idempotent: true });
    const [batchRows, firstRenders] = (await this.#sql.batch([{ sql: SELECT_BATCH, params: [batchId], idempotent: true }, rendersPage(START)])) as [SqlRow[], SqlRow[]];
    const batch = finishedBatch(batchRows, batchId);
    const rows = await this.#remainingPages(firstRenders, rendersPage);
    return compareWithApprovals(batch, rows.map((row) => ({ story: row.story as string, imageHash: row.image_hash as string | null, failure: row.failure as string | null, playError: row.play_error as string | null })), decisions, { includeUnchanged });
  }

  /** Every decision made at these commits. One parameter however many, so a long history is one statement. */
  async decisionsAt(environment: string, commits: readonly string[]): Promise<readonly PlacedDecision[]> {
    const rows = await this.#sql.run({ sql: DECISIONS_AT, params: [environment, JSON.stringify(commits)], idempotent: true });
    return rows.map((row) => ({
      story: row.story as string,
      imageHash: row.image_hash === REMOVAL ? null : (row.image_hash as string),
      decision: row.decision as DecisionKind,
      actor: row.actor as string,
      at: row.decided_at as number,
      batchId: row.batch_id as string,
    }));
  }

  /** The commits of a branch's batches between two times, which a rebase may have left out of its history. */
  async commitsOfBranch(branch: string, environment: string, since: number, until: number): Promise<readonly string[]> {
    const rows = await this.#sql.run({ sql: COMMITS_OF_BRANCH, params: [branch, environment, since, until], idempotent: true });
    return rows.map((row) => row.git_sha as string);
  }

  async #compare(
    batchId: string,
    baseline: string,
    statements: typeof AGAINST_GOLDENS,
    { includeUnchanged = false }: CompareOptions = {},
    assertFound: (found: boolean, batch: RenderBatch) => void,
  ): Promise<Comparison> {
    const comparedPage = (after: string): SqlStatement => ({
      sql: statements.comparedPage,
      params: [batchId, baseline, after, ROWS_PER_PAGE, includeUnchanged ? 1 : 0],
      idempotent: true,
    });
    const removedPage = (after: string): SqlStatement => ({
      sql: statements.removedPage,
      params: [batchId, baseline, after, ROWS_PER_PAGE],
      idempotent: true,
    });

    // One request, which is all a comparison shorter than a page needs.
    const [batchRows, baselineRows, unchangedRows, firstCompared, firstRemoved] =
      (await this.#sql.batch([
        { sql: SELECT_BATCH, params: [batchId], idempotent: true },
        { sql: statements.baseline, params: [batchId, baseline], idempotent: true },
        { sql: statements.unchangedCount, params: [batchId, baseline], idempotent: true },
        comparedPage(START),
        removedPage(START),
      ])) as [SqlRow[], SqlRow[], SqlRow[], SqlRow[], SqlRow[]];

    const batch = finishedBatch(batchRows, batchId);
    assertFound(baselineRows[0]?.batch_key !== null, batch);
    const compared = await this.#remainingPages(firstCompared, comparedPage);
    const removed = await this.#remainingPages(firstRemoved, removedPage);
    return {
      batch,
      renders: [...compared.map(toComparedRender), ...removed.map(toRemovedRender)],
      unchangedCount: unchangedRows[0]?.total as number,
    };
  }

  async #remainingPages(
    first: readonly SqlRow[],
    pageAfter: (after: string) => SqlStatement,
  ): Promise<SqlRow[]> {
    const rows = [...first];
    let page = first;
    while (page.length === ROWS_PER_PAGE) {
      page = await this.#sql.run(pageAfter(page[page.length - 1]!.story as string));
      rows.push(...page);
    }
    return rows;
  }

  /**
   * Records a person's or agent's decision on these renders, now. It holds for this
   * name and this image hash, in any batch and at any Git SHA, and for no other image.
   * Each name and hash keeps only its most recent decision.
   */
  async decide({ environment, decision, actor, renders, on }: DecisionRequest): Promise<void> {
    assertNamePart(environment, "environment");
    if (actor === "") throw new RangeError("A decision must say who made it");
    assertGitSha(on.gitSha);
    assertBatchIdShape(on.batchId);
    const at = this.#now();
    const statements = chunks(renders, RENDERS_PER_DECISION_STATEMENT).map((group) => {
      const params: SqlParam[] = [environment, decision, actor, at, on.gitSha, on.batchId];
      const values = group.map(({ story, imageHash }) => {
        assertNamePart(story, "story");
        if (imageHash !== null) assertImageHash(imageHash);
        return `(?${params.push(story)}, ?${params.push(imageHash ?? REMOVAL)})`;
      });
      return {
        sql: `WITH v(story, image_hash) AS (VALUES ${values.join(", ")})
INSERT INTO decisions(environment, story, image_hash, decision, actor, decided_at, git_sha, batch_id)
SELECT ?1, v.story, v.image_hash, ?2, ?3, CAST(?4 AS INTEGER), ?5, ?6 FROM v WHERE true
ON CONFLICT(environment, story, image_hash, git_sha) DO UPDATE SET
  decision = excluded.decision, actor = excluded.actor, decided_at = excluded.decided_at, batch_id = excluded.batch_id`,
        params,
        idempotent: true,
      };
    });
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /**
   * Makes a finished batch's images the goldens of its Git SHA in its environment,
   * replacing any there, if each is the same as the baseline's or approved at exactly
   * that hash, and `removedSeen` is how many renders the baseline has and the batch
   * lacks. If an image isn't accepted, returns false and changes nothing: `compareBatch`
   * shows which. Throws if the count is wrong, so goldens are never silently dropped by
   * a filtered render or a discovery bug, and if the batch was recorded on a dirty tree,
   * since a SHA's goldens must describe that commit. A null baseline means every image
   * needs an approval, and nothing can be removed.
   */
  async acceptBatch(batchId: string, baselineSha: string | null, removedSeen: number): Promise<boolean> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    const baseline = baselineSha ?? "";
    const [batchRows, baselineRows, accepted] = (await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: AGAINST_GOLDENS.baseline, params: [batchId, baseline], idempotent: true },
      { sql: ACCEPT_BATCH, params: [batchId, baseline, removedSeen], idempotent: true },
    ])) as [SqlRow[], SqlRow[], SqlRow[]];

    const batch = finishedBatch(batchRows, batchId);
    assertCanBeGoldens(batch);
    assertGoldensFound(baselineSha, baselineRows[0]?.batch_key !== null, batch);
    if (accepted.length > 0) return true;

    const [removed] = await this.#sql.run({
      sql: SELECT_REMOVED_COUNT,
      params: [batchId, baseline],
      idempotent: true,
    });
    if (removed?.total !== removedSeen) {
      throw new BatchError(
        "wrong-removed-count",
        `Accepting batch ${batchId} would remove ${String(removed?.total)} goldens, not the ${removedSeen} the reviewer saw`,
      );
    }
    return false;
  }

  /** The stories a baseline's goldens have, and this batch doesn't, which accepting it would remove. */
  async removedFrom(batchId: string, baselineSha: string | null): Promise<readonly string[]> {
    const removed: string[] = [];
    for (let after = ""; ; ) {
      const rows = await this.#sql.run({ sql: AGAINST_GOLDENS.removedPage, params: [batchId, baselineSha ?? "", after, ROWS_PER_PAGE], idempotent: true });
      removed.push(...rows.map(({ story }) => story as string));
      if (rows.length < ROWS_PER_PAGE) return removed;
      after = removed.at(-1)!;
    }
  }

  /** A page of all a batch holds, by name, for another store to take. Unlike a comparison, it needs no baseline. */
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
        ...(row.image_hash === null ? { failure: row.failure as string } : { imageHash: row.image_hash as string }),
        ...(row.play_error === null ? {} : { playError: row.play_error as string }),
        decision: row.decision === null ? null : { decision: row.decision as DecisionKind, actor: row.actor as string, at: row.decided_at as number, gitSha: row.git_sha as string, batchId: row.batch_id as string },
      })),
      next: rows.length > limit ? (page.at(-1)!.story as string) : null,
    };
  }

  /**
   * Takes decisions from another store. For one name and hash the latest wins, and at the
   * same moment a rejection does, so two stores reach one verdict whichever order they hear
   * in. Who made it travels with it, and isn't compared, so sending a decision back to where
   * it came from can't change whose it is. It may name an image this store doesn't hold yet.
   */
  async mergeDecisions(environment: string, decisions: readonly ReceivedDecision[]): Promise<void> {
    assertNamePart(environment, "environment");
    const statements = chunks(decisions, DECISIONS_PER_MERGE_STATEMENT).map((group) => {
      const params: SqlParam[] = [environment];
      const values = group.map(({ story, imageHash, decision, actor, at, gitSha, batchId }) => {
        assertNamePart(story, "story");
        assertImageHash(imageHash);
        assertGitSha(gitSha);
        assertBatchIdShape(batchId);
        if (actor === "") throw new RangeError("A decision must say who made it");
        return `(?${params.push(story)}, ?${params.push(imageHash)}, ?${params.push(decision)}, ?${params.push(actor)}, CAST(?${params.push(at)} AS INTEGER), ?${params.push(gitSha)}, ?${params.push(batchId)})`;
      });
      return {
        sql: `WITH v(story, image_hash, decision, actor, decided_at, git_sha, batch_id) AS (VALUES ${values.join(", ")})
INSERT INTO decisions(environment, story, image_hash, decision, actor, decided_at, git_sha, batch_id)
SELECT ?1, v.story, v.image_hash, v.decision, v.actor, v.decided_at, v.git_sha, v.batch_id FROM v WHERE true
ON CONFLICT(environment, story, image_hash, git_sha) DO UPDATE SET
  decision = excluded.decision, actor = excluded.actor, decided_at = excluded.decided_at, batch_id = excluded.batch_id
WHERE (excluded.decided_at, excluded.decision) > (decisions.decided_at, decisions.decision)`,
        params,
        idempotent: true,
      };
    });
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /**
   * Makes a finished batch the goldens of its Git SHA because the store that decides them
   * says so, replacing any here, without the checks of `acceptBatch`, which that store made.
   * It must still be able to be goldens: complete, and from a clean tree.
   */
  async adoptGoldens(batchId: string): Promise<void> {
    const [batch, adopted] = (await this.#sql.batch([
      { sql: SELECT_BATCH, params: [batchId], idempotent: true },
      { sql: ADOPT_GOLDENS, params: [batchId], idempotent: true },
    ])) as [SqlRow[], SqlRow[]];
    if (adopted.length === 0) assertCanBeGoldens(finishedBatch(batch, batchId));
  }

  /** The ID of the batch whose images are this SHA's goldens in this environment, or null. */
  async acceptedBatchAt(gitSha: string, environment: string): Promise<string | null> {
    assertGitSha(gitSha);
    const [row] = await this.#sql.run({
      sql: `SELECT render_batches.id AS id FROM goldens JOIN render_batches ON render_batches.key = goldens.batch_key
WHERE goldens.git_sha = ?1 AND goldens.environment = ?2`,
      params: [gitSha, environment],
      idempotent: true,
    });
    return row === undefined ? null : (row.id as string);
  }

  /**
   * The first of these SHAs, in the order given, with complete goldens in this environment,
   * or null. One query per group, and none after the group that holds it.
   */
  async firstWithGoldens(gitShas: readonly string[], environment: string): Promise<string | null> {
    gitShas.forEach(assertGitSha);
    for (const group of chunks(gitShas, SHAS_PER_GOLDENS_QUERY)) {
      const rows = await this.#sql.run({
        sql: `SELECT git_sha FROM goldens WHERE environment = ?1 AND git_sha IN (${group
          .map((_, i) => `?${i + 2}`)
          .join(", ")})`,
        params: [environment, ...group],
        idempotent: true,
      });
      const found = new Set(rows.map((row) => row.git_sha as string));
      const first = group.find((sha) => found.has(sha));
      if (first !== undefined) return first;
    }
    return null;
  }
}

// Before every name, since a story is never empty.
const START = "";

interface RecordStatement {
  readonly statement: SqlStatement;
  /** How many rows it must return, one for each render it wrote. */
  readonly rows: number;
}

function recordStatements(batchId: string, renders: readonly RecordedRender[]): RecordStatement[] {
  const names = new Set<string>();
  for (const { story, imageHash } of renders) {
    assertNamePart(story, "story");
    if (imageHash !== undefined) assertImageHash(imageHash);
    if (names.has(story)) throw new RangeError(`Story recorded twice in one call: ${story}`);
    names.add(story);
  }

  const statements: RecordStatement[] = [];
  let params: SqlParam[] = [batchId];
  let values: string[] = [];
  const flush = () => {
    if (values.length === 0) return;
    statements.push({
      statement: { sql: recordSql(values.join(", ")), params, idempotent: true },
      rows: values.length,
    });
    params = [batchId];
    values = [];
  };
  for (const { story, imageHash, failure, playError } of renders) {
    const needed = playError == null ? 2 : 3;
    if (params.length + needed > MAX_RECORD_PARAMS) flush();
    const name = `?${params.push(story)}`;
    // Sql binds no nulls, so the column a row leaves empty is a literal.
    const result =
      imageHash !== undefined
        ? `?${params.push(imageHash)}, NULL`
        : `NULL, ?${params.push(cleanMessage(failure))}`;
    const play = playError == null ? "NULL" : `?${params.push(cleanMessage(playError))}`;
    values.push(`(${name}, ${result}, ${play})`);
  }
  flush();
  return statements;
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

function assertGoldensFound(baselineSha: string | null, found: boolean, batch: RenderBatch): void {
  if (baselineSha !== null && !found) {
    throw new BatchError("no-goldens", `${baselineSha} has no goldens in environment ${batch.environment}`);
  }
}

function assertBatchIdShape(batchId: string): void {
  if (!isBatchId(batchId)) throw new RangeError(`A decision's batch must be a batch ID, got ${JSON.stringify(batchId)}`);
}

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
    branch: row.branch as string | null,
  };
}

// The same order as `NEWEST_DECISION` and the merge rule: latest first, then `rejected` before `approved`.
const newestFirst = (a: PlacedDecision, b: PlacedDecision) => b.at - a.at || b.decision.localeCompare(a.decision);

/**
 * A batch's renders against the approvals that history reaches. Pure, since this is the rule. A
 * story's reference is the image of its newest approval, leaving out any made on this batch. A
 * decision counts for an image if it's newer than that approval, so an image approved long ago
 * and since replaced asks again if a change brings it back.
 */
export function compareWithApprovals(
  batch: RenderBatch,
  rendered: readonly { readonly story: string; readonly imageHash: string | null; readonly failure: string | null; readonly playError: string | null }[],
  decisions: readonly PlacedDecision[],
  { includeUnchanged = false }: CompareOptions = {},
): Comparison {
  const byStory = new Map<string, PlacedDecision[]>();
  for (const decision of decisions) {
    const list = byStory.get(decision.story);
    if (list === undefined) byStory.set(decision.story, [decision]);
    else list.push(decision);
  }
  for (const list of byStory.values()) list.sort(newestFirst);

  const referenceOf = (story: string) => byStory.get(story)?.find(({ decision, batchId }) => decision === "approved" && batchId !== batch.id);
  /** What's been said about this image since the reference, if anything has. */
  const decisionOn = (story: string, imageHash: string | null, referenceAt: number): Decision | null => {
    const found = byStory.get(story)?.find((decision) => decision.imageHash === imageHash && decision.at >= referenceAt);
    return found === undefined ? null : { decision: found.decision, actor: found.actor, at: found.at };
  };

  const compared: ComparedRender[] = [];
  let unchangedCount = 0;
  for (const { story, imageHash, failure, playError } of rendered) {
    const reference = referenceOf(story);
    const goldenHash = reference?.imageHash ?? null;
    const state = stateOf(imageHash, goldenHash);
    if (state === "unchanged") unchangedCount += 1;
    if (state === "unchanged" && !includeUnchanged && playError === null) continue;
    compared.push({ story, state, imageHash, goldenHash, ...(goldenHash === null ? {} : { goldenBatchId: reference!.batchId }), failure, playError, decision: imageHash === null ? null : decisionOn(story, imageHash, reference?.at ?? 0) });
  }

  const here = new Set(rendered.map(({ story }) => story));
  const removed: ComparedRender[] = [];
  for (const story of [...byStory.keys()].sort()) {
    if (here.has(story)) continue;
    const reference = referenceOf(story);
    if (reference === undefined || reference.imageHash === null) continue;
    removed.push({ story, state: "removed", imageHash: null, goldenHash: reference.imageHash, goldenBatchId: reference.batchId, failure: null, playError: null, decision: decisionOn(story, null, reference.at) });
  }
  return { batch, renders: [...compared, ...removed], unchangedCount };
}

const stateOf = (imageHash: string | null, goldenHash: string | null): RenderState =>
  imageHash === null ? "failed" : goldenHash === null ? "added" : imageHash === goldenHash ? "unchanged" : "changed";

function toComparedRender(row: SqlRow): ComparedRender {
  const imageHash = row.image_hash as string | null;
  const goldenHash = row.golden_hash as string | null;
  const state = stateOf(imageHash, goldenHash);
  return {
    story: row.story as string,
    state,
    imageHash,
    goldenHash,
    failure: row.failure as string | null,
    playError: row.play_error as string | null,
    decision:
      row.decision === null
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
    playError: null,
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

function assertCanBeGoldens(batch: RenderBatch): void {
  if (batch.status === "failed") {
    throw new BatchError("batch-has-failures", `Batch ${batch.id} has ${batch.failedCount} failed stories, so it can't become goldens`);
  }
  if (batch.dirty) {
    throw new BatchError("batch-dirty", `Batch ${batch.id} was recorded on a dirty tree, so it doesn't describe ${batch.gitSha}`);
  }
}

function insertBatchStatement({ id, gitSha, environment, startedAt, dirty, storyFilter, reusedFromBatch, scale, branch }: ReceivedBatch): SqlStatement {
  assertGitSha(gitSha);
  assertNamePart(environment, "environment");
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`A batch's scale must be a positive number, got ${scale}`);
  return {
    // Sql binds no nulls, so an empty string stands for one.
    sql: `INSERT INTO render_batches(id, git_sha, environment, started_at, dirty, story_filter, reused_from_batch, scale, branch)
VALUES (?1, ?2, ?3, CAST(?4 AS INTEGER), CAST(?5 AS INTEGER), NULLIF(?6, ''), NULLIF(?7, ''), ?8, NULLIF(?9, ''))
ON CONFLICT(id) DO NOTHING`,
    params: [id, gitSha, environment, startedAt, dirty ? 1 : 0, storyFilter === null ? "" : JSON.stringify(storyFilter), reusedFromBatch ?? "", scale, branch ?? ""],
    idempotent: true,
  };
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
