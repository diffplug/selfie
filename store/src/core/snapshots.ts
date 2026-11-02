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
  snapshot_count INTEGER,
  failed_count INTEGER
)`,
  "CREATE INDEX IF NOT EXISTS runs_by_sha ON runs(git_sha, environment, started_at)",
  `CREATE TABLE IF NOT EXISTS run_snapshots (
  run_key INTEGER NOT NULL,
  story TEXT NOT NULL,
  settings TEXT NOT NULL,
  image_key INTEGER,
  failure TEXT,
  PRIMARY KEY (run_key, story, settings),
  CHECK ((image_key IS NULL) <> (failure IS NULL))
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS decisions (
  environment TEXT NOT NULL,
  story TEXT NOT NULL,
  settings TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  actor TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (environment, story, settings, image_hash)
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS goldens (
  git_sha TEXT NOT NULL,
  environment TEXT NOT NULL,
  run_key INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (git_sha, environment)
) WITHOUT ROWID`,
];

// These fit the limit of 100 bound parameters per statement: three per snapshot, plus
// what all of a statement's snapshots share.
const SNAPSHOTS_PER_RECORD_STATEMENT = 33;
const SNAPSHOTS_PER_DECISION_STATEMENT = 32;

// Sizes measured on real D1: `docs/specs/snapshots.rationale.md`. A request of 400 statements
// holds 13,200 snapshots, so a run of up to that many costs one.
const STATEMENTS_PER_REQUEST = 400;
const ROWS_PER_PAGE = 5_000;

// Enough to read, and it bounds how large one request can grow.
const MAX_FAILURE_CHARACTERS = 2_000;

const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const RUN_COLUMNS = "id, git_sha, environment, started_at, finished_at, snapshot_count, failed_count";

const SELECT_RUN = `SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?1`;

// The key of the run holding a baseline's goldens, only ever in the run's own
// environment. Uncorrelated, so SQLite evaluates it once. An empty ?2 means no baseline.
const BASELINE_RUN_KEY = `(SELECT g.run_key FROM goldens g
  WHERE g.git_sha = ?2 AND g.environment = (SELECT environment FROM runs WHERE id = ?1))`;

const SELECT_BASELINE = `SELECT ${BASELINE_RUN_KEY} AS run_key`;

const SELECT_COMPARED_PAGE = `SELECT rs.story, rs.settings, i.hash AS image_hash, rs.failure,
  gi.hash AS golden_hash, d.decision, d.actor, d.decided_at
FROM runs r
CROSS JOIN run_snapshots rs ON rs.run_key = r.key
LEFT JOIN images i ON i.key = rs.image_key
LEFT JOIN run_snapshots gs ON gs.run_key = ${BASELINE_RUN_KEY}
  AND gs.story = rs.story AND gs.settings = rs.settings
LEFT JOIN images gi ON gi.key = gs.image_key
LEFT JOIN decisions d ON d.environment = r.environment AND d.story = rs.story
  AND d.settings = rs.settings AND d.image_hash = i.hash
WHERE r.id = ?1 AND (rs.story, rs.settings) > (?3, ?4)
ORDER BY rs.story, rs.settings
LIMIT CAST(?5 AS INTEGER)`;

const SELECT_REMOVED_PAGE = `SELECT gs.story, gs.settings, gi.hash AS golden_hash
FROM run_snapshots gs
JOIN images gi ON gi.key = gs.image_key
WHERE gs.run_key = ${BASELINE_RUN_KEY} AND (gs.story, gs.settings) > (?3, ?4)
  AND NOT EXISTS (SELECT 1 FROM run_snapshots rs
    WHERE rs.run_key = (SELECT key FROM runs WHERE id = ?1)
      AND rs.story = gs.story AND rs.settings = gs.settings)
ORDER BY gs.story, gs.settings
LIMIT CAST(?5 AS INTEGER)`;

const SELECT_SNAPSHOT_PAGE = `SELECT rs.story, rs.settings, i.hash AS image_hash, rs.failure
FROM run_snapshots rs
LEFT JOIN images i ON i.key = rs.image_key
WHERE rs.run_key = (SELECT key FROM runs WHERE id = ?1) AND (rs.story, rs.settings) > (?2, ?3)
ORDER BY rs.story, rs.settings
LIMIT CAST(?4 AS INTEGER)`;

// The check and the write are one statement, so no decision can change between them,
// and the goldens of a SHA appear whole. Running it again finds the row it wrote, which
// the `>=` updates to itself and returns.
const ACCEPT_RUN = `INSERT INTO goldens(git_sha, environment, run_key, accepted_at)
SELECT r.git_sha, r.environment, r.key, CAST(?3 AS INTEGER)
FROM runs r
WHERE r.id = ?1 AND r.finished_at IS NOT NULL AND r.failed_count = 0
  AND (?2 = '' OR ${BASELINE_RUN_KEY} IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM run_snapshots rs
    LEFT JOIN run_snapshots gs ON gs.run_key = ${BASELINE_RUN_KEY}
      AND gs.story = rs.story AND gs.settings = rs.settings
    WHERE rs.run_key = r.key AND gs.image_key IS NOT rs.image_key
      AND NOT EXISTS (
        SELECT 1 FROM decisions d
        WHERE d.environment = r.environment AND d.story = rs.story AND d.settings = rs.settings
          AND d.decision = 'approved'
          AND d.image_hash = (SELECT hash FROM images WHERE key = rs.image_key)
      )
  )
ON CONFLICT(git_sha, environment) DO UPDATE SET
  run_key = excluded.run_key, accepted_at = excluded.accepted_at
WHERE (excluded.accepted_at, excluded.run_key) >= (goldens.accepted_at, goldens.run_key)
RETURNING run_key`;

// Counted in the statement that marks the run, so a batch that never landed can't be
// marked finished. Running it again changes nothing, since a finished run takes no rows.
const FINISH_RUN = `UPDATE runs SET
  finished_at = COALESCE(finished_at, CAST(?2 AS INTEGER)),
  snapshot_count = c.total,
  failed_count = c.failed
FROM (
  SELECT COUNT(*) AS total, COALESCE(SUM(image_key IS NULL), 0) AS failed
  FROM run_snapshots
  WHERE run_key = (SELECT key FROM runs WHERE id = ?1)
) AS c
WHERE runs.id = ?1 AND c.total = CAST(?3 AS INTEGER)
RETURNING ${RUN_COLUMNS}`;

const COUNT_SNAPSHOTS = `SELECT COUNT(*) AS total FROM run_snapshots
WHERE run_key = (SELECT key FROM runs WHERE id = ?1)`;

// The two differ only in where the third value goes. A finished run matches neither, so
// its statement returns too few rows, which is how `recordSnapshots` knows.
const recordSql = (values: string, select: string, from: string) =>
  `WITH v(story, settings, value) AS (VALUES ${values})
INSERT INTO run_snapshots(run_key, story, settings, image_key, failure)
SELECT r.key, v.story, v.settings, ${select}
FROM runs r CROSS JOIN v${from}
WHERE r.id = ?1 AND r.finished_at IS NULL
ON CONFLICT(run_key, story, settings) DO UPDATE SET
  image_key = excluded.image_key, failure = excluded.failure
RETURNING 1 AS written`;

/** The part of a snapshot's name its run doesn't already fix. */
export interface SnapshotKey {
  /** The Storybook story ID. Opaque here. */
  readonly story: string;
  /**
   * Render settings that aren't part of the environment, in one canonical form, since
   * they are compared as a string. Empty or absent means none.
   */
  readonly settings?: string;
}

/** What a run recorded for one story: the stored image's hash, or why it failed. */
export type RecordedSnapshot =
  | (SnapshotKey & { readonly imageHash: string; readonly failure?: undefined })
  | (SnapshotKey & { readonly failure: string; readonly imageHash?: undefined });

/**
 * - `recording`: not finished. It is still being written, or its writer crashed, so it
 *   may lack snapshots, and can be resumed.
 * - `complete`: finished, and every story rendered.
 * - `failed`: finished, and at least one story failed to render.
 */
export type RunStatus = "recording" | "complete" | "failed";

export interface Run {
  readonly id: string;
  readonly gitSha: string;
  readonly environment: string;
  readonly status: RunStatus;
  readonly startedAt: number;
  /** Null until finished, as are the two counts. */
  readonly finishedAt: number | null;
  readonly snapshotCount: number | null;
  readonly failedCount: number | null;
}

export type DecisionKind = "approved" | "rejected";

export interface Decision {
  readonly decision: DecisionKind;
  readonly actor: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

export type SnapshotState = "unchanged" | "changed" | "new" | "removed" | "failed";

export interface ComparedSnapshot {
  readonly story: string;
  readonly settings: string;
  readonly state: SnapshotState;
  /** The run's image. Null if `removed` or `failed`. */
  readonly imageHash: string | null;
  /** The baseline's image. Null if `new`, and if `failed` with no golden for this name. */
  readonly goldenHash: string | null;
  /** Null unless `failed`. */
  readonly failure: string | null;
  /** The decision on exactly `imageHash` for this name, if there is one. */
  readonly decision: Decision | null;
}

export interface Comparison {
  readonly run: Run;
  readonly baselineSha: string | null;
  /** The run's snapshots in name order, then the removed ones in name order. */
  readonly snapshots: readonly ComparedSnapshot[];
}

export interface DecisionRequest {
  /** With each snapshot's key, this is its name. */
  readonly environment: string;
  readonly decision: DecisionKind;
  readonly actor: string;
  /** Defaults to now. Pass it to keep when a decision was really made, as sync will. */
  readonly at?: number;
  readonly snapshots: readonly (SnapshotKey & { readonly imageHash: string })[];
}

export type SnapshotErrorCode =
  | "unknown-run"
  /** The run takes no more snapshots, since it was finished. */
  | "run-finished"
  /** The run is still `recording`, so it can't be compared or accepted. */
  | "run-not-finished"
  /** The run is `failed`, so it can't become goldens. */
  | "run-has-failures"
  /** Finishing was asked for with a different count than the run holds. */
  | "wrong-snapshot-count"
  /** A snapshot named an image that isn't stored. */
  | "unknown-image"
  /** The baseline SHA has no goldens in the run's environment. */
  | "no-goldens";

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
  async beginRun({ gitSha, environment }: { gitSha: string; environment: string }): Promise<Run> {
    assertGitSha(gitSha);
    assertNamePart(environment, "environment");
    const id = crypto.randomUUID();
    const startedAt = this.#now();
    await this.#sql.run({
      sql: `INSERT INTO runs(id, git_sha, environment, started_at)
VALUES (?1, ?2, ?3, CAST(?4 AS INTEGER))
ON CONFLICT(id) DO NOTHING`,
      params: [id, gitSha, environment, startedAt],
      idempotent: true,
    });
    return {
      id,
      gitSha,
      environment,
      status: "recording",
      startedAt,
      finishedAt: null,
      snapshotCount: null,
      failedCount: null,
    };
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
   */
  async finishRun(runId: string, expectedCount: number): Promise<Run> {
    const [row] = await this.#sql.run({
      sql: FINISH_RUN,
      params: [runId, this.#now(), expectedCount],
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

  /** What a run holds so far, in name order, so that resuming it can skip those stories. */
  async listSnapshots(runId: string): Promise<RecordedSnapshot[]> {
    const page = (after: PageCursor): SqlStatement => ({
      sql: SELECT_SNAPSHOT_PAGE,
      params: [runId, after.story, after.settings, ROWS_PER_PAGE],
      idempotent: true,
    });
    const rows = await this.#remainingPages(await this.#sql.run(page(START)), page);
    return rows.map(toRecordedSnapshot);
  }

  /**
   * Gives each snapshot its state, from image hashes alone, against the goldens of
   * `baselineSha` in the run's own environment. A null baseline means there are none
   * yet, so every rendered snapshot is `new`. Refuses a run still `recording`, since a
   * snapshot it doesn't hold yet would read as removed.
   */
  async compareRun(runId: string, baselineSha: string | null): Promise<Comparison> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    const baseline = baselineSha ?? "";
    const pageOf = (sql: string) => (after: PageCursor): SqlStatement => ({
      sql,
      params: [runId, baseline, after.story, after.settings, ROWS_PER_PAGE],
      idempotent: true,
    });
    const comparedPage = pageOf(SELECT_COMPARED_PAGE);
    const removedPage = pageOf(SELECT_REMOVED_PAGE);

    // One request, which is all a run shorter than a page needs.
    const [runRows, baselineRows, firstCompared, firstRemoved] = (await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: SELECT_BASELINE, params: [runId, baseline], idempotent: true },
      comparedPage(START),
      removedPage(START),
    ])) as [SqlRow[], SqlRow[], SqlRow[], SqlRow[]];

    const run = finishedRun(runRows, runId);
    assertBaselineFound(baselineSha, baselineRows, run);
    const compared = await this.#remainingPages(firstCompared, comparedPage);
    const removed = await this.#remainingPages(firstRemoved, removedPage);
    return {
      run,
      baselineSha,
      snapshots: [...compared.map(toComparedSnapshot), ...removed.map(toRemovedSnapshot)],
    };
  }

  async #remainingPages(
    first: readonly SqlRow[],
    pageAfter: (after: PageCursor) => SqlStatement,
  ): Promise<SqlRow[]> {
    const rows = [...first];
    let page = first;
    while (page.length === ROWS_PER_PAGE) {
      const last = page[page.length - 1]!;
      page = await this.#sql.run(
        pageAfter({ story: last.story as string, settings: last.settings as string }),
      );
      rows.push(...page);
    }
    return rows;
  }

  /**
   * Records a person's or agent's decision on these snapshots. It holds for this name
   * and this image hash, in any run and at any Git SHA, and for no other image. Each name
   * and hash keeps only its latest decision, so the same decisions in any order, any
   * number of times, leave the same one standing.
   */
  async decide(request: DecisionRequest): Promise<void> {
    const { environment, decision, actor, at = this.#now(), snapshots } = request;
    assertNamePart(environment, "environment");
    if (actor === "") throw new RangeError("A decision must say who made it");
    const statements = chunks(snapshots, SNAPSHOTS_PER_DECISION_STATEMENT).map((group) => {
      const params: SqlParam[] = [environment, decision, actor, at];
      const values = placeRows(params, group, ({ story, settings = "", imageHash }) => {
        assertNamePart(story, "story");
        assertSettings(settings);
        assertImageHash(imageHash);
        return [story, settings, imageHash];
      });
      return {
        sql: `WITH v(story, settings, image_hash) AS (VALUES ${values})
INSERT INTO decisions(environment, story, settings, image_hash, decision, actor, decided_at)
SELECT ?1, v.story, v.settings, v.image_hash, ?2, ?3, CAST(?4 AS INTEGER) FROM v WHERE true
ON CONFLICT(environment, story, settings, image_hash) DO UPDATE SET
  decision = excluded.decision, actor = excluded.actor, decided_at = excluded.decided_at
WHERE (excluded.decided_at, excluded.decision, excluded.actor)
  > (decisions.decided_at, decisions.decision, decisions.actor)`,
        params,
        idempotent: true,
      };
    });
    for (const group of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(group);
  }

  /**
   * Makes a finished run's images the goldens of its Git SHA in its environment,
   * replacing any there, if each is the same as the baseline's or approved at exactly
   * that hash. If one isn't, returns false and changes nothing: `compareRun` shows which.
   * A null baseline means every image needs an approval.
   */
  async acceptRun(runId: string, baselineSha: string | null): Promise<boolean> {
    if (baselineSha !== null) assertGitSha(baselineSha);
    const baseline = baselineSha ?? "";
    const [runRows, baselineRows, accepted] = (await this.#sql.batch([
      { sql: SELECT_RUN, params: [runId], idempotent: true },
      { sql: SELECT_BASELINE, params: [runId, baseline], idempotent: true },
      { sql: ACCEPT_RUN, params: [runId, baseline, this.#now()], idempotent: true },
    ])) as [SqlRow[], SqlRow[], SqlRow[]];

    const run = finishedRun(runRows, runId);
    if (run.status === "failed") {
      throw new SnapshotError(
        "run-has-failures",
        `Run ${runId} has ${run.failedCount} failed stories, so it can't become goldens`,
      );
    }
    assertBaselineFound(baselineSha, baselineRows, run);
    return accepted.length > 0;
  }

  /** Whether this SHA has a complete set of goldens in this environment. */
  async hasCompleteGoldens(gitSha: string, environment: string): Promise<boolean> {
    assertGitSha(gitSha);
    const rows = await this.#sql.run({
      sql: "SELECT 1 AS found FROM goldens WHERE git_sha = ?1 AND environment = ?2",
      params: [gitSha, environment],
      idempotent: true,
    });
    return rows.length > 0;
  }

  /** The accepted image per story as of this SHA in this environment, or null if it has none. */
  async goldens(gitSha: string, environment: string): Promise<RecordedSnapshot[] | null> {
    assertGitSha(gitSha);
    const [row] = await this.#sql.run({
      sql: `SELECT r.id FROM goldens g JOIN runs r ON r.key = g.run_key
WHERE g.git_sha = ?1 AND g.environment = ?2`,
      params: [gitSha, environment],
      idempotent: true,
    });
    return row === undefined ? null : this.listSnapshots(row.id as string);
  }
}

interface PageCursor {
  readonly story: string;
  readonly settings: string;
}

// Before every name, since a story is never empty.
const START: PageCursor = { story: "", settings: "" };

interface RecordStatement {
  readonly statement: SqlStatement;
  /** How many rows it must return, one for each snapshot it wrote. */
  readonly rows: number;
}

function recordStatements(runId: string, snapshots: readonly RecordedSnapshot[]): RecordStatement[] {
  const names = new Set<string>();
  for (const { story, settings = "" } of snapshots) {
    assertNamePart(story, "story");
    assertSettings(settings);
    const name = JSON.stringify([story, settings]);
    if (names.has(name)) throw new RangeError(`Story recorded twice in one call: ${name}`);
    names.add(name);
  }

  const statement = (
    group: readonly RecordedSnapshot[],
    sql: (values: string) => string,
    third: (snapshot: RecordedSnapshot) => string,
  ): RecordStatement => {
    const params: SqlParam[] = [runId];
    const values = placeRows(params, group, (snapshot) => [
      snapshot.story,
      snapshot.settings ?? "",
      third(snapshot),
    ]);
    return { statement: { sql: sql(values), params, idempotent: true }, rows: group.length };
  };
  const rendered = snapshots.filter(({ imageHash }) => imageHash !== undefined);
  const failed = snapshots.filter(({ imageHash }) => imageHash === undefined);
  return [
    ...chunks(rendered, SNAPSHOTS_PER_RECORD_STATEMENT).map((group) =>
      statement(
        group,
        (values) => recordSql(values, "i.key, NULL", " CROSS JOIN images i ON i.hash = v.value"),
        ({ imageHash }) => {
          assertImageHash(imageHash!);
          return imageHash!;
        },
      ),
    ),
    ...chunks(failed, SNAPSHOTS_PER_RECORD_STATEMENT).map((group) =>
      statement(
        group,
        (values) => recordSql(values, "NULL, v.value", ""),
        ({ failure }) => cleanFailure(failure!),
      ),
    ),
  ];
}

/** Appends each row's values to `params`, returning their numbered placeholders. */
function placeRows<T>(
  params: SqlParam[],
  rows: readonly T[],
  values: (row: T) => readonly SqlParam[],
): string {
  return rows
    .map((row) => {
      const placeholders = values(row).map((value) => `?${params.push(value)}`);
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** Cut by code point, so a cut never splits a surrogate pair. */
function cleanFailure(failure: string): string {
  return Array.from(failure.replaceAll("\0", "")).slice(0, MAX_FAILURE_CHARACTERS).join("");
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

function assertBaselineFound(baselineSha: string | null, rows: readonly SqlRow[], run: Run): void {
  if (baselineSha !== null && rows[0]?.run_key === null) {
    throw new SnapshotError(
      "no-goldens",
      `${baselineSha} has no goldens in environment ${run.environment}`,
    );
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
    snapshotCount: row.snapshot_count as number | null,
    failedCount,
  };
}

function toRecordedSnapshot(row: SqlRow): RecordedSnapshot {
  const key = { story: row.story as string, settings: row.settings as string };
  return row.image_hash === null
    ? { ...key, failure: row.failure as string }
    : { ...key, imageHash: row.image_hash as string };
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
    settings: row.settings as string,
    state,
    imageHash,
    goldenHash,
    failure: row.failure as string | null,
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
    settings: row.settings as string,
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
    throw new RangeError(`A snapshot's ${what} must be non-empty with no NUL: ${JSON.stringify(part)}`);
  }
}

function assertSettings(settings: string): void {
  if (settings.includes("\0")) throw new RangeError("A snapshot's settings may not contain NUL");
}
