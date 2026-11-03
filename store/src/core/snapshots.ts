import { chunks } from "./chunks.ts";
import { assertImageHash } from "./image-hash.ts";
import type { Sql, SqlParam, SqlRow, SqlStatement } from "./sql.ts";

/**
 * The tables behind `Snapshots`, which `initStoreSchema` creates. Rows hold the image
 * key and the run key for compactness, and both stay private to this store: everything
 * this module takes or returns names an image by its hash and a run by its `id`.
 */
export const CREATE_SNAPSHOT_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
  key INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  git_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  failed_count INTEGER,
  dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
  baseline_sha TEXT,
  story_filter TEXT,
  reused_from_run TEXT,
  scale REAL NOT NULL
)`,
  "CREATE INDEX IF NOT EXISTS runs_by_sha ON runs(git_sha, environment, started_at)",
  `CREATE TABLE IF NOT EXISTS run_snapshots (
  run_key INTEGER NOT NULL,
  story TEXT NOT NULL,
  image_key INTEGER,
  failure TEXT,
  play_error TEXT,
  PRIMARY KEY (run_key, story),
  CHECK ((image_key IS NULL) <> (failure IS NULL))
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS decisions (
  environment TEXT NOT NULL,
  story TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  actor TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (environment, story, image_hash)
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS goldens (
  git_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  run_key INTEGER NOT NULL,
  PRIMARY KEY (git_sha, environment)
) WITHOUT ROWID`,
];

// These fit the limit of 100 bound parameters per statement, beside what all of a
// statement's rows share. A recorded snapshot takes two, or three with a play error,
// so a statement holds 49 when none has one, and at least 33.
const MAX_RECORD_PARAMS = 100;
const SNAPSHOTS_PER_DECISION_STATEMENT = 48;
// Beside the environment, a merged decision takes five.
const DECISIONS_PER_MERGE_STATEMENT = 19;
// Nearest first, beside the environment.
const SHAS_PER_GOLDENS_QUERY = 99;

// Sizes measured on real D1: `docs/specs/snapshots.rationale.md`. A request of 400
// statements holds 19,600 snapshots, so a run of up to that many costs one.
const STATEMENTS_PER_REQUEST = 400;
const ROWS_PER_PAGE = 5_000;

// Enough to read, and it bounds how large one request can grow.
const MAX_MESSAGE_CHARACTERS = 2_000;

const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A full SHA-1 or SHA-256 commit ID. */
export const isGitSha = (value: string) => GIT_SHA.test(value);
/** What leaves a store to name a run. */
export const isRunId = (value: string) => RUN_ID.test(value);

const RUN_COLUMNS =
  "id, git_sha, environment, started_at, finished_at, failed_count, dirty, baseline_sha, story_filter, reused_from_run, scale";

const SELECT_RUN = `SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?1`;

// The key of the run holding a baseline's goldens, only ever in the run's own
// environment. Uncorrelated, so SQLite evaluates it once. An empty ?2 means no baseline.
const GOLDENS_RUN_KEY = `(SELECT g.run_key FROM goldens g
  WHERE g.git_sha = ?2 AND g.environment = (SELECT environment FROM runs WHERE id = ?1))`;

// The key of a finished run named by ?2, only ever in the run's own environment.
const NAMED_RUN_KEY = `(SELECT b.key FROM runs b
  WHERE b.id = ?2 AND b.finished_at IS NOT NULL
    AND b.environment = (SELECT environment FROM runs WHERE id = ?1))`;

/** A comparison's statements, against whichever run a key expression finds. */
const comparisonStatements = (baselineKey: string) => ({
  baseline: `SELECT ${baselineKey} AS run_key`,
  // `gs` joins before the images so that a row left out never reads them.
  comparedPage: `SELECT rs.story, i.hash AS image_hash, rs.failure, rs.play_error,
  gi.hash AS golden_hash, d.decision, d.actor, d.decided_at
FROM runs r
CROSS JOIN run_snapshots rs ON rs.run_key = r.key
LEFT JOIN run_snapshots gs ON gs.run_key = ${baselineKey} AND gs.story = rs.story
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN images gi ON gi.key = gs.image_key
LEFT JOIN decisions d ON d.environment = r.environment AND d.story = rs.story
  AND d.image_hash = i.hash
WHERE r.id = ?1 AND rs.story > ?3
  AND (CAST(?5 AS INTEGER) = 1 OR rs.image_key IS NULL
    OR rs.image_key IS NOT gs.image_key OR rs.play_error IS NOT NULL)
ORDER BY rs.story
LIMIT CAST(?4 AS INTEGER)`,
  removedPage: `SELECT gs.story, gi.hash AS golden_hash
FROM run_snapshots gs
JOIN images gi ON gi.key = gs.image_key
WHERE gs.run_key = ${baselineKey} AND gs.story > ?3
  AND NOT EXISTS (SELECT 1 FROM run_snapshots rs
    WHERE rs.run_key = (SELECT key FROM runs WHERE id = ?1) AND rs.story = gs.story)
ORDER BY gs.story
LIMIT CAST(?4 AS INTEGER)`,
  unchangedCount: `SELECT COUNT(*) AS total
FROM run_snapshots rs
JOIN run_snapshots gs ON gs.run_key = ${baselineKey} AND gs.story = rs.story
WHERE rs.run_key = (SELECT key FROM runs WHERE id = ?1) AND rs.image_key = gs.image_key`,
});

const AGAINST_GOLDENS = comparisonStatements(GOLDENS_RUN_KEY);
const AGAINST_RUN = comparisonStatements(NAMED_RUN_KEY);

const COUNT_REMOVED = `(SELECT COUNT(*) FROM run_snapshots gs
  WHERE gs.run_key = ${GOLDENS_RUN_KEY}
    AND NOT EXISTS (SELECT 1 FROM run_snapshots rs
      WHERE rs.run_key = (SELECT key FROM runs WHERE id = ?1) AND rs.story = gs.story))`;

const SELECT_REMOVED_COUNT = `SELECT ${COUNT_REMOVED} AS total`;

const CAN_BE_GOLDENS = "r.finished_at IS NOT NULL AND r.failed_count = 0 AND r.dirty = 0";

// The checks and the write are one statement, so nothing can change between them, and
// the goldens of a SHA appear whole. Sent again, it must still succeed, so a run already
// accepted passes without the checks: accepting a rerun over its own SHA's goldens makes
// the baseline itself, and then nothing reads as removed.
const ACCEPT_RUN = `INSERT INTO goldens(git_sha, environment, run_key)
SELECT r.git_sha, r.environment, r.key
FROM runs r
WHERE r.id = ?1 AND ${CAN_BE_GOLDENS}
  AND (?2 = '' OR ${GOLDENS_RUN_KEY} IS NOT NULL)
  AND (
    EXISTS (SELECT 1 FROM goldens a
      WHERE a.git_sha = r.git_sha AND a.environment = r.environment AND a.run_key = r.key)
    OR (
      ${COUNT_REMOVED} = CAST(?3 AS INTEGER)
      AND NOT EXISTS (
        SELECT 1 FROM run_snapshots rs
        LEFT JOIN run_snapshots gs ON gs.run_key = ${GOLDENS_RUN_KEY} AND gs.story = rs.story
        WHERE rs.run_key = r.key AND gs.image_key IS NOT rs.image_key
          AND NOT EXISTS (
            SELECT 1 FROM decisions d
            WHERE d.environment = r.environment AND d.story = rs.story
              AND d.decision = 'approved'
              AND d.image_hash = (SELECT hash FROM images WHERE key = rs.image_key)
          )
      )
    )
  )
ON CONFLICT(git_sha, environment) DO UPDATE SET run_key = excluded.run_key
RETURNING run_key`;

// Counted in the statement that marks the run, so a batch that never landed can't be
// marked finished. Running it again changes nothing, since a finished run takes no rows.
const FINISH_RUN = `UPDATE runs SET
  finished_at = COALESCE(finished_at, CAST(?2 AS INTEGER)),
  failed_count = c.failed
FROM (
  SELECT COUNT(*) AS total, COALESCE(SUM(image_key IS NULL), 0) AS failed
  FROM run_snapshots
  WHERE run_key = (SELECT key FROM runs WHERE id = ?1)
) AS c
WHERE runs.id = ?1 AND c.total = CAST(?3 AS INTEGER)
RETURNING ${RUN_COLUMNS}`;

// Not by the checks that accepting makes, since another store already made them.
const ADOPT_GOLDENS = `INSERT INTO goldens(git_sha, environment, run_key)
SELECT r.git_sha, r.environment, r.key FROM runs r
WHERE r.id = ?1 AND ${CAN_BE_GOLDENS}
ON CONFLICT(git_sha, environment) DO UPDATE SET run_key = excluded.run_key
RETURNING run_key`;

const READ_RUN_PAGE = `SELECT rs.story, i.hash AS image_hash, rs.failure, rs.play_error, d.decision, d.actor, d.decided_at
FROM runs r
CROSS JOIN run_snapshots rs ON rs.run_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN decisions d ON d.environment = r.environment AND d.story = rs.story AND d.image_hash = i.hash
WHERE r.id = ?1 AND rs.story > ?2
ORDER BY rs.story
LIMIT CAST(?3 AS INTEGER)`;

const COUNT_SNAPSHOTS = `SELECT COUNT(*) AS total FROM run_snapshots
WHERE run_key = (SELECT key FROM runs WHERE id = ?1)`;

// A row with a hash the images table lacks, or a finished run, matches nothing, so the
// statement returns too few rows, which is how `recordSnapshots` knows.
const recordSql = (values: string) =>
  `WITH v(story, image_hash, failure, play_error) AS (VALUES ${values})
INSERT INTO run_snapshots(run_key, story, image_key, failure, play_error)
SELECT r.key, v.story, i.key, v.failure, v.play_error
FROM runs r CROSS JOIN v LEFT JOIN images i ON i.hash = v.image_hash
WHERE r.id = ?1 AND r.finished_at IS NULL AND (v.image_hash IS NULL OR i.key IS NOT NULL)
ON CONFLICT(run_key, story) DO UPDATE SET
  image_key = excluded.image_key, failure = excluded.failure,
  play_error = excluded.play_error
RETURNING 1 AS written`;

/**
 * What a run recorded for one story: the stored image's hash, or why it failed.
 * `playError` says why its play function failed, on a story that may still have rendered.
 */
export type RecordedSnapshot = {
  /** The story ID, with any render variant in it. Opaque here. */
  readonly story: string;
  readonly playError?: string | null;
} & (
  | { readonly imageHash: string; readonly failure?: undefined }
  | { readonly failure: string; readonly imageHash?: undefined }
);

/**
 * - `recording`: not finished. It is still being written, or its writer crashed, so it
 *   may lack snapshots. After a crash, start a new run.
 * - `complete`: finished, and every story rendered.
 * - `failed`: finished, and at least one story failed to render.
 */
export type RunStatus = "recording" | "complete" | "failed";

/** The `--story` patterns that limited a run, and those that matched nothing. */
export interface StoryFilter {
  readonly patterns: readonly string[];
  readonly unmatched: readonly string[];
}

export interface Run {
  readonly id: string;
  readonly gitSha: string;
  readonly environment: string;
  readonly status: RunStatus;
  readonly startedAt: number;
  /** Null until finished, as is `failedCount`. */
  readonly finishedAt: number | null;
  readonly failedCount: number | null;
  /** The working tree had changes, so the images may not describe `gitSha`. Never accepted. */
  readonly dirty: boolean;
  /** The baseline its reviewer saw, or null if there was none. */
  readonly baselineSha: string | null;
  /** Null if every story was asked for. */
  readonly storyFilter: StoryFilter | null;
  /**
   * The run that really rendered these images, or null if this one did. An ID only: it says where
   * the pixels came from, and `gitSha` still says what the run was recorded against.
   */
  readonly reusedFromRun: string | null;
  /** Image pixels per CSS pixel, which the environment's ID hides inside its hash. */
  readonly scale: number;
}

export type DecisionKind = "approved" | "rejected";

export interface Decision {
  readonly decision: DecisionKind;
  readonly actor: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

export type SnapshotState = "unchanged" | "changed" | "new" | "removed" | "failed";

/** Whether a snapshot in this state has an image that can take a decision. */
export const isDecidable = (state: SnapshotState): boolean => state === "changed" || state === "new";

export interface ComparedSnapshot {
  readonly story: string;
  readonly state: SnapshotState;
  /** The run's image. Null if `removed` or `failed`. */
  readonly imageHash: string | null;
  /** The baseline's image. Null if `new`, and if `failed` with no golden for this name. */
  readonly goldenHash: string | null;
  /** Null unless `failed`. */
  readonly failure: string | null;
  /** As recorded: null if there was none, and always null if `removed`. */
  readonly playError: string | null;
  /** The decision on exactly `imageHash` for this name, if there is one. */
  readonly decision: Decision | null;
}

export interface Comparison {
  readonly run: Run;
  /**
   * In name order, the run's differences from the baseline and anything with a play
   * error, then the removed snapshots. Other unchanged ones only if asked for.
   */
  readonly snapshots: readonly ComparedSnapshot[];
  /** How many of the run's snapshots are `unchanged`, whether listed or not. */
  readonly unchangedCount: number;
}

export interface CompareOptions {
  /** List every unchanged snapshot too. Reads and returns far more. */
  readonly includeUnchanged?: boolean;
}

export interface DecisionRequest {
  /** With each snapshot's story, this is its name. */
  readonly environment: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  readonly snapshots: readonly { readonly story: string; readonly imageHash: string }[];
}

/** A run as another store holds it, which keeps its identity and its times here. */
export type ReceivedRun = Omit<Run, "status" | "finishedAt" | "failedCount">;

/** A decision as another store holds it, which keeps its time here. */
export interface ReceivedDecision extends Decision {
  readonly story: string;
  readonly imageHash: string;
}

/** What a run holds, as a page of a read by name. */
export interface RunPage {
  readonly run: Run;
  readonly snapshots: readonly (RecordedSnapshot & { readonly decision: Decision | null })[];
  /** Where the next page starts, or null if this is the last. */
  readonly next: string | null;
}

export type SnapshotErrorCode =
  | "unknown-run"
  /** The run takes no more snapshots, since it was finished. */
  | "run-finished"
  /** The run is still `recording`, so it can't be compared or accepted. */
  | "run-not-finished"
  /** The run is `failed`, so it can't become goldens. */
  | "run-has-failures"
  /** The run was recorded on a dirty tree, so it can't become goldens. */
  | "run-dirty"
  /** Finishing was asked for with a different count than the run holds. */
  | "wrong-snapshot-count"
  /** Accepting was asked for with a different count of removed snapshots than there are. */
  | "wrong-removed-count"
  /** A snapshot named an image that isn't stored. */
  | "unknown-image"
  /** A run with this ID is already here, and it isn't this one. */
  | "run-conflict"
  /** The baseline SHA has no goldens in the run's environment. */
  | "no-goldens"
  | "no-baseline-run";

/** The request can't apply to the data as it stands. */
export class SnapshotError extends Error {
  override readonly name = "SnapshotError";
  readonly code: SnapshotErrorCode;

  constructor(code: SnapshotErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SnapshotsOptions {
  readonly sql: Sql;
  /** Defaults to `Date.now`. Tests inject one to control time. */
  readonly now?: () => number;
}

/**
 * Runs, comparisons, decisions, and goldens, over `Sql` alone. Every statement is safe
 * to resend, and nothing relies on a batch being atomic. See `docs/specs/snapshots.md`.
 */
export class Snapshots {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor({ sql, now = Date.now }: SnapshotsOptions) {
    this.#sql = sql;
    this.#now = now;
  }

  /** Starts a run, which stays `recording` until `finishRun`. */
  async beginRun(options: {
    gitSha: string;
    environment: string;
    scale: number;
    dirty: boolean;
    baselineSha: string | null;
    storyFilter?: StoryFilter | null;
    reusedFromRun?: string | null;
  }): Promise<Run> {
    const run: ReceivedRun = { storyFilter: null, reusedFromRun: null, ...options, id: crypto.randomUUID(), startedAt: this.#now() };
    await this.#sql.run(insertRunStatement(run));
    return { ...run, status: "recording", finishedAt: null, failedCount: null };
  }

  /**
   * Starts holding a run that began in another store, under its own ID and times. If it's
   * already here, this says how far it got, so a resend can carry on: an unfinished one
   * takes its snapshots again, and a finished one needs nothing. Throws if that ID is here
   * for different facts, since a run never changes.
   */
  async receiveRun(received: ReceivedRun): Promise<Run> {
    const [, rows] = await this.#sql.batch([insertRunStatement(received), { sql: SELECT_RUN, params: [received.id], idempotent: true }]);
    const run = toRun(rows![0]!);
    const { gitSha, environment, startedAt, dirty, baselineSha, scale } = received;
    if (run.gitSha !== gitSha || run.environment !== environment || run.startedAt !== startedAt || run.dirty !== dirty || run.baselineSha !== baselineSha || run.scale !== scale) {
      throw new SnapshotError("run-conflict", `Run ${received.id} is already here, and it isn't this one`);
    }
    return run;
  }

  /**
   * Adds snapshots to a `recording` run. A failure can leave any of them written, so
   * after one, send them again: a name the run already holds takes the newer result.
   * Each image must already be stored, by `Store.putImages`.
   */
  async recordSnapshots(runId: string, snapshots: readonly RecordedSnapshot[]): Promise<void> {
    const statements = recordStatements(runId, snapshots);
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) {
      const results = await this.#sql.batch(group.map(({ statement }) => statement));
      const written = results.reduce((sum, rows) => sum + rows.length, 0);
      const sent = group.reduce((sum, { rows }) => sum + rows, 0);
      if (written < sent) await this.#explainUnrecorded(runId, sent - written);
    }
  }

  async #explainUnrecorded(runId: string, missing: number): Promise<never> {
    const run = await this.getRun(runId);
    if (run === null) throw new SnapshotError("unknown-run", `No run ${runId}`);
    if (run.status !== "recording") {
      throw new SnapshotError("run-finished", `Run ${runId} is finished and takes no more snapshots`);
    }
    throw new SnapshotError(
      "unknown-image",
      `${missing} snapshots were not recorded, since their images are not stored`,
    );
  }

  /**
   * Ends a run, if it holds exactly `expectedCount` snapshots, failed ones included.
   * If not it stays `recording` and this throws, so a batch that was lost shows here.
   * A run from another store gives the time it finished there.
   */
  async finishRun(runId: string, expectedCount: number, finishedAt: number = this.#now()): Promise<Run> {
    const [row] = await this.#sql.run({
      sql: FINISH_RUN,
      params: [runId, finishedAt, expectedCount],
      idempotent: true,
    });
    if (row !== undefined) return toRun(row);

    const [runRows, countRows] = await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: COUNT_SNAPSHOTS, params: [runId], idempotent: true },
    ]);
    if (runRows?.[0] === undefined) throw new SnapshotError("unknown-run", `No run ${runId}`);
    throw new SnapshotError(
      "wrong-snapshot-count",
      `Run ${runId} holds ${String(countRows?.[0]?.total)} snapshots, not the ${expectedCount} expected`,
    );
  }

  async getRun(runId: string): Promise<Run | null> {
    const [row] = await this.#sql.run({ sql: SELECT_RUN, params: [runId], idempotent: true });
    return row === undefined ? null : toRun(row);
  }

  /** Every run of this SHA in this environment, newest first, reruns and crashed ones included. */
  async runsAt(gitSha: string, environment: string): Promise<Run[]> {
    assertGitSha(gitSha);
    const rows = await this.#sql.run({
      sql: `SELECT ${RUN_COLUMNS} FROM runs
WHERE git_sha = ?1 AND environment = ?2
ORDER BY started_at DESC, key DESC`,
      params: [gitSha, environment],
      idempotent: true,
    });
    return rows.map(toRun);
  }

  /**
   * Gives a finished run's snapshots their states, from image hashes alone, against the
   * goldens of `baselineSha` in the run's own environment. A null baseline means there
   * are none yet, so every rendered snapshot is `new`. Lists only what a reviewer needs
   * unless told otherwise: see `Comparison`.
   */
  async compareRun(runId: string, baselineSha: string | null, options?: CompareOptions): Promise<Comparison> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    return this.#compare(runId, baselineSha ?? "", AGAINST_GOLDENS, options, (found, run) =>
      assertGoldensFound(baselineSha, found, run),
    );
  }

  /** As `compareRun`, with the images of another finished run in this environment standing in for goldens. */
  async compareWithRun(runId: string, baselineRunId: string, options?: CompareOptions): Promise<Comparison> {
    return this.#compare(runId, baselineRunId, AGAINST_RUN, options, (found, run) => {
      if (!found) {
        throw new SnapshotError("no-baseline-run", `${baselineRunId} isn't a finished run in environment ${run.environment}`);
      }
    });
  }

  async #compare(
    runId: string,
    baseline: string,
    statements: typeof AGAINST_GOLDENS,
    { includeUnchanged = false }: CompareOptions = {},
    assertFound: (found: boolean, run: Run) => void,
  ): Promise<Comparison> {
    const comparedPage = (after: string): SqlStatement => ({
      sql: statements.comparedPage,
      params: [runId, baseline, after, ROWS_PER_PAGE, includeUnchanged ? 1 : 0],
      idempotent: true,
    });
    const removedPage = (after: string): SqlStatement => ({
      sql: statements.removedPage,
      params: [runId, baseline, after, ROWS_PER_PAGE],
      idempotent: true,
    });

    // One request, which is all a comparison shorter than a page needs.
    const [runRows, baselineRows, unchangedRows, firstCompared, firstRemoved] =
      (await this.#sql.batch([
        { sql: SELECT_RUN, params: [runId], idempotent: true },
        { sql: statements.baseline, params: [runId, baseline], idempotent: true },
        { sql: statements.unchangedCount, params: [runId, baseline], idempotent: true },
        comparedPage(START),
        removedPage(START),
      ])) as [SqlRow[], SqlRow[], SqlRow[], SqlRow[], SqlRow[]];

    const run = finishedRun(runRows, runId);
    assertFound(baselineRows[0]?.run_key !== null, run);
    const compared = await this.#remainingPages(firstCompared, comparedPage);
    const removed = await this.#remainingPages(firstRemoved, removedPage);
    return {
      run,
      snapshots: [...compared.map(toComparedSnapshot), ...removed.map(toRemovedSnapshot)],
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
   * Records a person's or agent's decision on these snapshots, now. It holds for this
   * name and this image hash, in any run and at any Git SHA, and for no other image.
   * Each name and hash keeps only its most recent decision.
   */
  async decide({ environment, decision, actor, snapshots }: DecisionRequest): Promise<void> {
    assertNamePart(environment, "environment");
    if (actor === "") throw new RangeError("A decision must say who made it");
    const at = this.#now();
    const statements = chunks(snapshots, SNAPSHOTS_PER_DECISION_STATEMENT).map((group) => {
      const params: SqlParam[] = [environment, decision, actor, at];
      const values = group.map(({ story, imageHash }) => {
        assertNamePart(story, "story");
        assertImageHash(imageHash);
        return `(?${params.push(story)}, ?${params.push(imageHash)})`;
      });
      return {
        sql: `WITH v(story, image_hash) AS (VALUES ${values.join(", ")})
INSERT INTO decisions(environment, story, image_hash, decision, actor, decided_at)
SELECT ?1, v.story, v.image_hash, ?2, ?3, CAST(?4 AS INTEGER) FROM v WHERE true
ON CONFLICT(environment, story, image_hash) DO UPDATE SET
  decision = excluded.decision, actor = excluded.actor, decided_at = excluded.decided_at`,
        params,
        idempotent: true,
      };
    });
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /**
   * Makes a finished run's images the goldens of its Git SHA in its environment,
   * replacing any there, if each is the same as the baseline's or approved at exactly
   * that hash, and `removedSeen` is how many snapshots the baseline has and the run
   * lacks. If an image isn't accepted, returns false and changes nothing: `compareRun`
   * shows which. Throws if the count is wrong, so goldens are never silently dropped by
   * a filtered render or a discovery bug, and if the run was recorded on a dirty tree,
   * since a SHA's goldens must describe that commit. A null baseline means every image
   * needs an approval, and nothing can be removed.
   */
  async acceptRun(runId: string, baselineSha: string | null, removedSeen: number): Promise<boolean> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    const baseline = baselineSha ?? "";
    const [runRows, baselineRows, accepted] = (await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: AGAINST_GOLDENS.baseline, params: [runId, baseline], idempotent: true },
      { sql: ACCEPT_RUN, params: [runId, baseline, removedSeen], idempotent: true },
    ])) as [SqlRow[], SqlRow[], SqlRow[]];

    const run = finishedRun(runRows, runId);
    assertCanBeGoldens(run);
    assertGoldensFound(baselineSha, baselineRows[0]?.run_key !== null, run);
    if (accepted.length > 0) return true;

    const [removed] = await this.#sql.run({
      sql: SELECT_REMOVED_COUNT,
      params: [runId, baseline],
      idempotent: true,
    });
    if (removed?.total !== removedSeen) {
      throw new SnapshotError(
        "wrong-removed-count",
        `Accepting run ${runId} would remove ${String(removed?.total)} goldens, not the ${removedSeen} the reviewer saw`,
      );
    }
    return false;
  }

  /** The stories a baseline's goldens have, and this run doesn't, which accepting it would remove. */
  async removedFrom(runId: string, baselineSha: string | null): Promise<readonly string[]> {
    const removed: string[] = [];
    for (let after = ""; ; ) {
      const rows = await this.#sql.run({ sql: AGAINST_GOLDENS.removedPage, params: [runId, baselineSha ?? "", after, ROWS_PER_PAGE], idempotent: true });
      removed.push(...rows.map(({ story }) => story as string));
      if (rows.length < ROWS_PER_PAGE) return removed;
      after = removed.at(-1)!;
    }
  }

  /** A page of all a run holds, by name, for another store to take. Unlike a comparison, it needs no baseline. */
  async readRun(runId: string, after = "", limit = ROWS_PER_PAGE): Promise<RunPage> {
    const [runRows, rows] = (await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: READ_RUN_PAGE, params: [runId, after, limit + 1], idempotent: true },
    ])) as [SqlRow[], SqlRow[]];
    const run = finishedRun(runRows, runId);
    const page = rows.slice(0, limit);
    return {
      run,
      snapshots: page.map((row) => ({
        story: row.story as string,
        ...(row.image_hash === null ? { failure: row.failure as string } : { imageHash: row.image_hash as string }),
        ...(row.play_error === null ? {} : { playError: row.play_error as string }),
        decision: row.decision === null ? null : { decision: row.decision as DecisionKind, actor: row.actor as string, at: row.decided_at as number },
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
      const values = group.map(({ story, imageHash, decision, actor, at }) => {
        assertNamePart(story, "story");
        assertImageHash(imageHash);
        if (actor === "") throw new RangeError("A decision must say who made it");
        return `(?${params.push(story)}, ?${params.push(imageHash)}, ?${params.push(decision)}, ?${params.push(actor)}, CAST(?${params.push(at)} AS INTEGER))`;
      });
      return {
        sql: `WITH v(story, image_hash, decision, actor, decided_at) AS (VALUES ${values.join(", ")})
INSERT INTO decisions(environment, story, image_hash, decision, actor, decided_at)
SELECT ?1, v.story, v.image_hash, v.decision, v.actor, v.decided_at FROM v WHERE true
ON CONFLICT(environment, story, image_hash) DO UPDATE SET
  decision = excluded.decision, actor = excluded.actor, decided_at = excluded.decided_at
WHERE (excluded.decided_at, excluded.decision) > (decisions.decided_at, decisions.decision)`,
        params,
        idempotent: true,
      };
    });
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /**
   * Makes a finished run the goldens of its Git SHA because the store that decides them
   * says so, replacing any here, without the checks of `acceptRun`, which that store made.
   * It must still be able to be goldens: complete, and from a clean tree.
   */
  async adoptGoldens(runId: string): Promise<void> {
    const [run, adopted] = (await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: ADOPT_GOLDENS, params: [runId], idempotent: true },
    ])) as [SqlRow[], SqlRow[]];
    if (adopted.length === 0) assertCanBeGoldens(finishedRun(run, runId));
  }

  /** Whether this SHA has a complete set of goldens in this environment. */
  async hasCompleteGoldens(gitSha: string, environment: string): Promise<boolean> {
    assertGitSha(gitSha);
    const rows = await this.#sql.run({
      sql: "SELECT 1 AS found FROM goldens WHERE git_sha = ?1 AND environment = ?2 LIMIT 1",
      params: [gitSha, environment],
      idempotent: true,
    });
    return rows.length > 0;
  }

  /** The ID of the run whose images are this SHA's goldens in this environment, or null. */
  async acceptedRunAt(gitSha: string, environment: string): Promise<string | null> {
    assertGitSha(gitSha);
    const [row] = await this.#sql.run({
      sql: `SELECT runs.id AS id FROM goldens JOIN runs ON runs.key = goldens.run_key
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
  /** How many rows it must return, one for each snapshot it wrote. */
  readonly rows: number;
}

function recordStatements(runId: string, snapshots: readonly RecordedSnapshot[]): RecordStatement[] {
  const names = new Set<string>();
  for (const { story, imageHash } of snapshots) {
    assertNamePart(story, "story");
    if (imageHash !== undefined) assertImageHash(imageHash);
    if (names.has(story)) throw new RangeError(`Story recorded twice in one call: ${story}`);
    names.add(story);
  }

  const statements: RecordStatement[] = [];
  let params: SqlParam[] = [runId];
  let values: string[] = [];
  const flush = () => {
    if (values.length === 0) return;
    statements.push({
      statement: { sql: recordSql(values.join(", ")), params, idempotent: true },
      rows: values.length,
    });
    params = [runId];
    values = [];
  };
  for (const { story, imageHash, failure, playError } of snapshots) {
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

function finishedRun(rows: readonly SqlRow[], runId: string): Run {
  const [row] = rows;
  if (row === undefined) throw new SnapshotError("unknown-run", `No run ${runId}`);
  const run = toRun(row);
  if (run.status === "recording") {
    throw new SnapshotError(
      "run-not-finished",
      `Run ${runId} is still recording, so what it lacks can't be told from what was removed`,
    );
  }
  return run;
}

function assertGoldensFound(baselineSha: string | null, found: boolean, run: Run): void {
  if (baselineSha !== null && !found) {
    throw new SnapshotError("no-goldens", `${baselineSha} has no goldens in environment ${run.environment}`);
  }
}

function toRun(row: SqlRow): Run {
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
    baselineSha: row.baseline_sha as string | null,
    storyFilter: row.story_filter === null ? null : (JSON.parse(row.story_filter as string) as StoryFilter),
    reusedFromRun: row.reused_from_run as string | null,
    scale: row.scale as number,
  };
}

function toComparedSnapshot(row: SqlRow): ComparedSnapshot {
  const imageHash = row.image_hash as string | null;
  const goldenHash = row.golden_hash as string | null;
  const state: SnapshotState =
    imageHash === null
      ? "failed"
      : goldenHash === null
        ? "new"
        : imageHash === goldenHash
          ? "unchanged"
          : "changed";
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

function toRemovedSnapshot(row: SqlRow): ComparedSnapshot {
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
    throw new RangeError(`A snapshot's ${what} must be non-empty with no NUL: ${JSON.stringify(part)}`);
  }
}

function assertCanBeGoldens(run: Run): void {
  if (run.status === "failed") {
    throw new SnapshotError("run-has-failures", `Run ${run.id} has ${run.failedCount} failed stories, so it can't become goldens`);
  }
  if (run.dirty) {
    throw new SnapshotError("run-dirty", `Run ${run.id} was recorded on a dirty tree, so it doesn't describe ${run.gitSha}`);
  }
}

function insertRunStatement({ id, gitSha, environment, startedAt, dirty, baselineSha, storyFilter, reusedFromRun, scale }: ReceivedRun): SqlStatement {
  assertGitSha(gitSha);
  assertNamePart(environment, "environment");
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`A run's scale must be a positive number, got ${scale}`);
  if (baselineSha !== null) assertGitSha(baselineSha);
  return {
    // Sql binds no nulls, so an empty string stands for one.
    sql: `INSERT INTO runs(id, git_sha, environment, started_at, dirty, baseline_sha, story_filter, reused_from_run, scale)
VALUES (?1, ?2, ?3, CAST(?4 AS INTEGER), CAST(?5 AS INTEGER), NULLIF(?6, ''), NULLIF(?7, ''), NULLIF(?8, ''), ?9)
ON CONFLICT(id) DO NOTHING`,
    params: [id, gitSha, environment, startedAt, dirty ? 1 : 0, baselineSha ?? "", storyFilter === null ? "" : JSON.stringify(storyFilter), reusedFromRun ?? "", scale],
    idempotent: true,
  };
}
