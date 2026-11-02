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
 * shared limit. A run spends about 75 requests against D1.
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

      const golden = await snapshots.beginRun({ gitSha: SHA_0, environment: "shared", scale: 1, dirty: false, baselineSha: null });
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
      const head = await snapshots.beginRun({ gitSha: SHA_1, environment: "shared", scale: 1, dirty: false, baselineSha: null });
      headRun = head.id;
      await snapshots.recordSnapshots(headRun, [
        rendered("a", 1),
        rendered("b", 5),
        { story: "c", failure: "Render threw" },
        rendered("e", 6),
      ]);
      await snapshots.finishRun(headRun, 4);

      // The same SHA again, where b came out differently and c rendered, unstably.
      const again = await snapshots.beginRun({ gitSha: SHA_1, environment: "shared", scale: 1, dirty: false, baselineSha: null });
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
        { story: "b", state: "changed", imageHash: hashOf(5), goldenHash: hashOf(2), failure: null, unstable: null, playError: null, decision: null },
        { story: "c", state: "failed", imageHash: null, goldenHash: hashOf(3), failure: "Render threw", unstable: null, playError: null, decision: null },
        { story: "e", state: "new", imageHash: hashOf(6), goldenHash: null, failure: null, unstable: null, playError: null, decision: null },
        { story: "d", state: "removed", imageHash: null, goldenHash: hashOf(4), failure: null, unstable: null, playError: null, decision: null },
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
      const other = await snapshots.beginRun({ gitSha: SHA_1, environment: "other", scale: 1, dirty: false, baselineSha: null });
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
      const crashed = await snapshots.beginRun({ gitSha: SHA_1, environment, scale: 1, dirty: false, baselineSha: null });
      await snapshots.recordSnapshots(crashed.id, [rendered("a", 1)]);

      const dying = over((adapter) => failing(adapter, () => true));
      await expect(dying.recordSnapshots(crashed.id, [rendered("b", 2)])).rejects.toThrow("Simulated");

      await expect(snapshots.finishRun(crashed.id, 2)).rejects.toMatchObject({ code: "wrong-snapshot-count" });
      await expect(snapshots.compareRun(crashed.id, null)).rejects.toMatchObject({ code: "run-not-finished" });

      const fresh = await snapshots.beginRun({ gitSha: SHA_1, environment, scale: 1, dirty: false, baselineSha: null });
      await snapshots.recordSnapshots(fresh.id, [rendered("a", 1), rendered("b", 2)]);
      expect(await snapshots.finishRun(fresh.id, 2)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("survives writes being resent, and ends with a complete set of goldens", async () => {
      const environment = "retried";
      const replayed = over(replaying);
      const run = await snapshots.beginRun({ gitSha: SHA_2, environment, scale: 1, dirty: false, baselineSha: null });
      await replayed.recordSnapshots(run.id, [rendered("a", 8)]);
      expect(await replayed.finishRun(run.id, 1)).toMatchObject({ status: "complete" });
      await snapshots.decide({
        environment,
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "a", imageHash: hashOf(8) }],
      });
      expect(await snapshots.acceptedRunAt(SHA_2, environment)).toBeNull();
      expect(await replayed.acceptRun(run.id, null, 0)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_2, environment)).toBe(true);
      expect(await snapshots.acceptedRunAt(SHA_2, environment)).toBe(run.id);
      expect(await snapshots.acceptedRunAt(SHA_2, "another environment")).toBeNull();
    });

    it("keeps what a run was recorded against, and never accepts a dirty one", async () => {
      const environment = "dirty";
      const storyFilter = { patterns: ["a*", "typo*"], unmatched: ["typo*"] };
      const run = await snapshots.beginRun({
        gitSha: SHA_2,
        environment,
        scale: 1,
        dirty: true,
        baselineSha: SHA_0,
        storyFilter,
      });
      expect(run).toMatchObject({ dirty: true, baselineSha: SHA_0, storyFilter });
      await snapshots.recordSnapshots(run.id, [rendered("a", 9)]);
      expect(await snapshots.finishRun(run.id, 1)).toMatchObject({ dirty: true, baselineSha: SHA_0, storyFilter });
      expect(await snapshots.getRun(run.id)).toMatchObject({ dirty: true, baselineSha: SHA_0, storyFilter });
      await snapshots.decide({
        environment,
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "a", imageHash: hashOf(9) }],
      });
      await expect(snapshots.acceptRun(run.id, null, 0)).rejects.toMatchObject({ code: "run-dirty" });
      expect(await snapshots.hasCompleteGoldens(SHA_2, environment)).toBe(false);

      const clean = await snapshots.beginRun({ gitSha: SHA_2, environment, scale: 1, dirty: false, baselineSha: null });
      expect(clean).toMatchObject({ dirty: false, baselineSha: null, storyFilter: null });
      expect(await snapshots.getRun(clean.id)).toMatchObject({ dirty: false, baselineSha: null, storyFilter: null });
    });

    it("keeps a run's scale, whole or not", async () => {
      for (const scale of [1, 1.5, 2]) {
        const run = await snapshots.beginRun({ gitSha: SHA_0, environment: "scaled", scale, dirty: false, baselineSha: null });
        expect(run.scale).toBe(scale);
        expect((await snapshots.getRun(run.id))?.scale).toBe(scale);
        expect((await snapshots.finishRun(run.id, 0)).scale).toBe(scale);
        expect((await snapshots.compareRun(run.id, null)).run.scale).toBe(scale);
      }
    });

    it("keeps which run really rendered a run's images, and which didn't", async () => {
      const environment = "reused";
      const rendered_ = await snapshots.beginRun({ gitSha: SHA_0, environment, scale: 1, dirty: false, baselineSha: null });
      expect(rendered_.reusedFromRun).toBeNull();
      expect((await snapshots.getRun(rendered_.id))?.reusedFromRun).toBeNull();

      const reused = await snapshots.beginRun({
        gitSha: SHA_1,
        environment,
        scale: 1,
        dirty: false,
        baselineSha: null,
        reusedFromRun: rendered_.id,
      });
      expect(reused.reusedFromRun).toBe(rendered_.id);
      await snapshots.recordSnapshots(reused.id, [rendered("a", 11)]);
      expect((await snapshots.finishRun(reused.id, 1)).reusedFromRun).toBe(rendered_.id);
      expect((await snapshots.getRun(reused.id))?.reusedFromRun).toBe(rendered_.id);
      expect((await snapshots.runsAt(SHA_1, environment))[0]?.reusedFromRun).toBe(rendered_.id);
      expect((await snapshots.compareRun(reused.id, null)).run.reusedFromRun).toBe(rendered_.id);
    });

    it("keeps a play error, and lists its snapshot even when unchanged", async () => {
      const environment = "play";
      const run = await snapshots.beginRun({ gitSha: SHA_0, environment, scale: 1, dirty: false, baselineSha: null });
      const played = [
        { ...rendered("a", 10), playError: "play threw" },
        rendered("b", 11),
        { story: "c", failure: "Render threw", playError: "play threw too" },
      ];
      await snapshots.recordSnapshots(run.id, played);
      await snapshots.finishRun(run.id, 3);
      const first = await snapshots.compareRun(run.id, null);
      expect(first.snapshots.map(({ story, playError }) => [story, playError])).toEqual([
        ["a", "play threw"],
        ["b", null],
        ["c", "play threw too"],
      ]);

      const golden = await snapshots.beginRun({ gitSha: SHA_1, environment, scale: 1, dirty: false, baselineSha: null });
      const clean = [rendered("a", 10), rendered("b", 11)];
      await snapshots.recordSnapshots(golden.id, clean);
      await snapshots.finishRun(golden.id, 2);
      await snapshots.decide({
        environment,
        decision: "approved",
        actor: "ned",
        snapshots: clean.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
      });
      expect(await snapshots.acceptRun(golden.id, null, 0)).toBe(true);

      const next = await snapshots.beginRun({ gitSha: SHA_2, environment, scale: 1, dirty: false, baselineSha: SHA_1 });
      await snapshots.recordSnapshots(next.id, [played[0]!, played[1]!]);
      await snapshots.finishRun(next.id, 2);
      const compared = await snapshots.compareRun(next.id, SHA_1);
      expect(compared.unchangedCount).toBe(2);
      expect(compared.snapshots.map(({ story, state }) => [story, state])).toEqual([["a", "unchanged"]]);
    });

    it("fits a whole statement of the longest play errors and failures", async () => {
      const environment = "long-play";
      const run = await snapshots.beginRun({ gitSha: SHA_0, environment, scale: 1, dirty: false, baselineSha: null });
      const count = 100;
      const long = "x".repeat(2_000);
      await snapshots.recordSnapshots(
        run.id,
        Array.from({ length: count }, (_, i) => ({ story: `s${i}`, failure: long, playError: long })),
      );
      expect(await snapshots.finishRun(run.id, count)).toMatchObject({ status: "failed", failedCount: count });
      const { snapshots: compared } = await snapshots.compareRun(run.id, null);
      expect(compared).toHaveLength(count);
      expect(compared[0]).toMatchObject({ failure: long, playError: long });
    });

    it("finds the nearest SHA with goldens, in the order asked, across query groups", async () => {
      const environment = "shared";
      const shas = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(40, "f"));
      expect(await snapshots.firstWithGoldens(shas, environment)).toBeNull();
      expect(await snapshots.firstWithGoldens([...shas, SHA_0], environment)).toBe(SHA_0);
      expect(await snapshots.firstWithGoldens([SHA_0, ...shas], "no-such-environment")).toBeNull();
      expect(await snapshots.firstWithGoldens([], environment)).toBeNull();
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
