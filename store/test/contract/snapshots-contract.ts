import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  imageInsertStatement,
  initStoreSchema,
  Snapshots,
  Sql,
  type RecordedSnapshot,
  type SqlAdapter,
  type SqlStatement,
} from "../../src/core/index.ts";
import { hashOf, withParamMode, type ParamMode } from "../support/sql-params.ts";

/** One database, shared by a whole run of the contract. */
export interface SnapshotTestDatabase {
  connect(): SqlAdapter;
  destroy(): Promise<void>;
}

const SHA_0 = "0".repeat(40);
const SHA_1 = "1".repeat(40);
const SHA_2 = "2".repeat(40);

/** Runs a batch twice, as a lost response and a resend would, returning the second's rows. */
export const replaying = (adapter: SqlAdapter): SqlAdapter => ({
  execute: async (statements) => {
    await adapter.execute(statements);
    return adapter.execute(statements);
  },
});

/** Fails the batches `shouldFail` picks, after running their first `ran` statements. */
export function failing(
  adapter: SqlAdapter,
  shouldFail: (statements: readonly SqlStatement[]) => boolean,
  ran = 0,
): SqlAdapter {
  return {
    execute: async (statements) => {
      if (!shouldFail(statements)) return adapter.execute(statements);
      await adapter.execute(statements.slice(0, ran));
      throw new Error("Simulated: the connection died");
    },
  };
}

export const rendered = (story: string, image: number): RecordedSnapshot => ({
  story,
  imageHash: hashOf(image),
});

const statesOf = (snapshots: readonly { story: string; state: string }[]) =>
  Object.fromEntries(snapshots.map(({ story, state }) => [story, state]));

/**
 * Run this with a factory to prove the model on an adapter. Tests share one database and
 * tell themselves apart by environment, since a reset per test would spend real D1's
 * shared limit. A run spends about 40 requests against D1.
 */
export function describeSnapshotContract(
  name: string,
  mode: ParamMode,
  factory: () => Promise<SnapshotTestDatabase>,
): void {
  describe(`Snapshot contract: ${name}, ${mode} parameters`, () => {
    let database: SnapshotTestDatabase;
    let snapshots: Snapshots;
    const over = (wrap: (adapter: SqlAdapter) => SqlAdapter) =>
      new Snapshots({ sql: new Sql(withParamMode(wrap(database.connect()), mode)) });

    /** The goldens of `SHA_0`: a run of A to D, approved as a whole. */
    const GOLDENS = [rendered("a", 1), rendered("b", 2), rendered("c", 3), rendered("d", 4)];
    let headRun: string;
    let rerun: string;

    beforeAll(async () => {
      database = await factory();
      const sql = new Sql(withParamMode(database.connect(), mode));
      snapshots = new Snapshots({ sql });
      await initStoreSchema(sql);
      await sql.batch(
        Array.from({ length: 12 }, (_, i) => imageInsertStatement(hashOf(i + 1), 1000 + i)),
      );

      const golden = await snapshots.beginRun({ gitSha: SHA_0, environment: "shared" });
      await snapshots.recordSnapshots(golden.id, GOLDENS);
      await snapshots.finishRun(golden.id, GOLDENS.length);
      await snapshots.decide({
        environment: "shared",
        decision: "approved",
        actor: "ned",
        snapshots: GOLDENS.map((snapshot) => ({ story: snapshot.story, imageHash: snapshot.imageHash! })),
      });
      expect(await snapshots.acceptRun(golden.id, null, 0)).toBe(true);

      // Against those goldens: a is unchanged, b changed, c failed, d removed, and e new.
      const head = await snapshots.beginRun({ gitSha: SHA_1, environment: "shared" });
      headRun = head.id;
      await snapshots.recordSnapshots(headRun, [
        rendered("a", 1),
        rendered("b", 5),
        { story: "c", failure: "Render threw" },
        rendered("e", 6),
      ]);
      await snapshots.finishRun(headRun, 4);

      // The same SHA again, where b came out differently and c rendered, unstably.
      const again = await snapshots.beginRun({ gitSha: SHA_1, environment: "shared" });
      rerun = again.id;
      await snapshots.recordSnapshots(rerun, [
        rendered("a", 1),
        rendered("b", 7),
        { ...rendered("c", 3), unstable: true },
        { ...rendered("e", 6), unstable: false },
      ]);
      await snapshots.finishRun(rerun, 4);
    });

    afterAll(async () => {
      await database?.destroy();
    });

    it("gives each difference its state, and counts what is unchanged", async () => {
      const { run, snapshots: compared, unchangedCount } = await snapshots.compareRun(headRun, SHA_0);
      expect(run).toMatchObject({ status: "failed", failedCount: 1 });
      expect(unchangedCount).toBe(1);
      expect(compared).toEqual([
        { story: "b", state: "changed", imageHash: hashOf(5), goldenHash: hashOf(2), failure: null, unstable: null, decision: null },
        { story: "c", state: "failed", imageHash: null, goldenHash: hashOf(3), failure: "Render threw", unstable: null, decision: null },
        { story: "e", state: "new", imageHash: hashOf(6), goldenHash: null, failure: null, unstable: null, decision: null },
        { story: "d", state: "removed", imageHash: null, goldenHash: hashOf(4), failure: null, unstable: null, decision: null },
      ]);
    });

    it("keeps reruns of a SHA apart, and a decision on one image off another", async () => {
      expect((await snapshots.runsAt(SHA_1, "shared")).map(({ id }) => id)).toEqual([rerun, headRun]);
      await snapshots.decide({
        environment: "shared",
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "b", imageHash: hashOf(5) }],
      });
      const head = await snapshots.compareRun(headRun, SHA_0);
      expect(head.snapshots[0]).toMatchObject({
        story: "b",
        imageHash: hashOf(5),
        decision: { decision: "approved", actor: "ned", at: expect.any(Number) },
      });
      const again = await snapshots.compareRun(rerun, SHA_0, { includeUnchanged: true });
      expect(statesOf(again.snapshots)).toEqual({
        a: "unchanged",
        b: "changed",
        c: "unchanged",
        e: "new",
        d: "removed",
      });
      expect(again.unchangedCount).toBe(2);
      expect(again.snapshots[1]).toMatchObject({ imageHash: hashOf(7), decision: null });
      expect(again.snapshots.map(({ unstable }) => unstable)).toEqual([null, null, true, false, null]);
    });

    it("never compares across environments", async () => {
      const other = await snapshots.beginRun({ gitSha: SHA_1, environment: "other" });
      await snapshots.recordSnapshots(other.id, [rendered("a", 1)]);
      await snapshots.finishRun(other.id, 1);
      // `SHA_0` has goldens, and the same image for the same story, in another environment.
      await expect(snapshots.compareRun(other.id, SHA_0)).rejects.toMatchObject({ code: "no-goldens" });
      const { snapshots: compared } = await snapshots.compareRun(other.id, null);
      // Approved in "shared" and not here, so a decision doesn't cross either.
      expect(compared).toMatchObject([{ story: "a", state: "new", decision: null }]);
    });

    it("leaves a crashed run recording, beside the new run that replaces it", async () => {
      const environment = "crash";
      const crashed = await snapshots.beginRun({ gitSha: SHA_1, environment });
      await snapshots.recordSnapshots(crashed.id, [rendered("a", 1)]);

      const dying = over((adapter) => failing(adapter, () => true));
      await expect(dying.recordSnapshots(crashed.id, [rendered("b", 2)])).rejects.toThrow("Simulated");

      await expect(snapshots.finishRun(crashed.id, 2)).rejects.toMatchObject({ code: "wrong-snapshot-count" });
      await expect(snapshots.compareRun(crashed.id, null)).rejects.toMatchObject({ code: "run-not-finished" });

      const fresh = await snapshots.beginRun({ gitSha: SHA_1, environment });
      await snapshots.recordSnapshots(fresh.id, [rendered("a", 1), rendered("b", 2)]);
      expect(await snapshots.finishRun(fresh.id, 2)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("survives writes being resent, and ends with a complete set of goldens", async () => {
      const environment = "retried";
      const replayed = over(replaying);
      const run = await snapshots.beginRun({ gitSha: SHA_2, environment });
      await replayed.recordSnapshots(run.id, [rendered("a", 8)]);
      expect(await replayed.finishRun(run.id, 1)).toMatchObject({ status: "complete" });
      await snapshots.decide({
        environment,
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "a", imageHash: hashOf(8) }],
      });
      expect(await replayed.acceptRun(run.id, null, 0)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_2, environment)).toBe(true);
    });

    it("refuses an acceptance that would drop goldens the reviewer didn't see", async () => {
      // The rerun lacks d, and the reviewer says nothing was removed.
      await expect(snapshots.acceptRun(rerun, SHA_0, 0)).rejects.toMatchObject({
        code: "wrong-removed-count",
        message: expect.stringContaining("would remove 1 goldens, not the 0"),
      });
    });
  });
}
