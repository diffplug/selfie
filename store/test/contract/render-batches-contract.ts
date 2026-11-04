import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  imageInsertStatement,
  initStoreSchema,
  RenderBatches,
  Sql,
  type RecordedRender,
  type SqlAdapter,
  type SqlStatement,
} from "../../src/core/index.ts";
import { hashOf, withParamMode, type ParamMode } from "../support/sql-params.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

/** One database, shared by a whole batch of the contract. */
export interface BatchTestDatabase {
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

export const rendered = (story: string, image: number): RecordedRender => ({
  story,
  imageHash: hashOf(image),
});

const statesOf = (renders: readonly { story: string; state: string }[]) =>
  Object.fromEntries(renders.map(({ story, state }) => [story, state]));

/**
 * Run this with a factory to prove the model on an adapter. Tests share one database and
 * tell themselves apart by environment, since a reset per test would spend real D1's
 * shared limit. A batch spends about 75 requests against D1.
 */
export function describeBatchContract(
  name: string,
  mode: ParamMode,
  factory: () => Promise<BatchTestDatabase>,
): void {
  describe(`Render contract: ${name}, ${mode} parameters`, () => {
    let database: BatchTestDatabase;
    let batches: RenderBatches;
    const over = (wrap: (adapter: SqlAdapter) => SqlAdapter) =>
      new RenderBatches({ sql: new Sql(withParamMode(wrap(database.connect()), mode)) });

    /** The goldens of `SHA_0`: a batch of A to D, approved as a whole. */
    const GOLDENS = [rendered("a", 1), rendered("b", 2), rendered("c", 3), rendered("d", 4)];
    let headBatch: string;
    let rerun: string;

    beforeAll(async () => {
      database = await factory();
      const sql = new Sql(withParamMode(database.connect(), mode));
      batches = new RenderBatches({ sql });
      await initStoreSchema(sql);
      await sql.batch(
        Array.from({ length: 12 }, (_, i) => imageInsertStatement(hashOf(i + 1), 1000 + i)),
      );

      const golden = await batches.beginBatch({ gitSha: SHA_0, environment: "shared", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(golden.id, GOLDENS);
      await batches.finishBatch(golden.id, GOLDENS.length);
      await batches.decide({ on: ON,
        environment: "shared",
        decision: "approved",
        actor: "ned",
        renders: GOLDENS.map((render) => ({ story: render.story, imageHash: render.imageHash! })),
      });
      expect(await batches.acceptBatch(golden.id, null, 0)).toBe(true);

      // Against those goldens: a is unchanged, b changed, c failed, d removed, and e new.
      const head = await batches.beginBatch({ gitSha: SHA_1, environment: "shared", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      headBatch = head.id;
      await batches.recordRenders(headBatch, [
        rendered("a", 1),
        rendered("b", 5),
        { story: "c", failure: "Render threw" },
        rendered("e", 6),
      ]);
      await batches.finishBatch(headBatch, 4);

      // The same SHA again, where b came out differently and c rendered, unstably.
      const again = await batches.beginBatch({ gitSha: SHA_1, environment: "shared", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      rerun = again.id;
      await batches.recordRenders(rerun, [
        rendered("a", 1),
        rendered("b", 7),
        rendered("c", 3),
        rendered("e", 6),
      ]);
      await batches.finishBatch(rerun, 4);
    });

    afterAll(async () => {
      await database?.destroy();
    });

    it("gives each difference its state, and counts what is unchanged", async () => {
      const { batch, renders: compared, unchangedCount } = await batches.compareBatch(headBatch, SHA_0);
      expect(batch).toMatchObject({ status: "failed", failedCount: 1 });
      expect(unchangedCount).toBe(1);
      expect(compared).toEqual([
        { story: "b", state: "changed", imageHash: hashOf(5), goldenHash: hashOf(2), failure: null, decision: null },
        { story: "c", state: "failed", imageHash: null, goldenHash: hashOf(3), failure: "Render threw", decision: null },
        { story: "e", state: "added", imageHash: hashOf(6), goldenHash: null, failure: null, decision: null },
        { story: "d", state: "removed", imageHash: null, goldenHash: hashOf(4), failure: null, decision: null },
      ]);
    });

    it("keeps reruns of a SHA apart, and a decision on one image off another", async () => {
      expect((await batches.batchesAt(SHA_1, "shared")).map(({ id }) => id)).toEqual([rerun, headBatch]);
      await batches.decide({ on: ON,
        environment: "shared",
        decision: "approved",
        actor: "ned",
        renders: [{ story: "b", imageHash: hashOf(5) }],
      });
      const head = await batches.compareBatch(headBatch, SHA_0);
      expect(head.renders[0]).toMatchObject({
        story: "b",
        imageHash: hashOf(5),
        decision: { decision: "approved", actor: "ned", at: expect.any(Number) },
      });
      const again = await batches.compareBatch(rerun, SHA_0, { includeUnchanged: true });
      expect(statesOf(again.renders)).toEqual({
        a: "unchanged",
        b: "changed",
        c: "unchanged",
        e: "added",
        d: "removed",
      });
      expect(again.unchangedCount).toBe(2);
      expect(again.renders[1]).toMatchObject({ imageHash: hashOf(7), decision: null });
    });

    it("never compares across environments", async () => {
      const other = await batches.beginBatch({ gitSha: SHA_1, environment: "other", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(other.id, [rendered("a", 1)]);
      await batches.finishBatch(other.id, 1);
      // `SHA_0` has goldens, and the same image for the same story, in another environment.
      await expect(batches.compareBatch(other.id, SHA_0)).rejects.toMatchObject({ code: "no-goldens" });
      const { renders: compared } = await batches.compareBatch(other.id, null);
      // Approved in "shared" and not here, so a decision doesn't cross either.
      expect(compared).toMatchObject([{ story: "a", state: "added", decision: null }]);
    });

    it("leaves a crashed batch recording, beside the new batch that replaces it", async () => {
      const environment = "crash";
      const crashed = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(crashed.id, [rendered("a", 1)]);

      const dying = over((adapter) => failing(adapter, () => true));
      await expect(dying.recordRenders(crashed.id, [rendered("b", 2)])).rejects.toThrow("Simulated");

      await expect(batches.finishBatch(crashed.id, 2)).rejects.toMatchObject({ code: "wrong-render-count" });
      await expect(batches.compareBatch(crashed.id, null)).rejects.toMatchObject({ code: "batch-not-finished" });

      const fresh = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(fresh.id, [rendered("a", 1), rendered("b", 2)]);
      expect(await batches.finishBatch(fresh.id, 2)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("survives writes being resent, and ends with a complete set of goldens", async () => {
      const environment = "retried";
      const replayed = over(replaying);
      const batch = await batches.beginBatch({ gitSha: SHA_2, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await replayed.recordRenders(batch.id, [rendered("a", 8)]);
      expect(await replayed.finishBatch(batch.id, 1)).toMatchObject({ status: "complete" });
      await batches.decide({ on: ON,
        environment,
        decision: "approved",
        actor: "ned",
        renders: [{ story: "a", imageHash: hashOf(8) }],
      });
      expect(await batches.acceptedBatchAt(SHA_2, environment)).toBeNull();
      expect(await replayed.acceptBatch(batch.id, null, 0)).toBe(true);
      expect(await batches.acceptedBatchAt(SHA_2, environment)).not.toBeNull();
      expect(await batches.acceptedBatchAt(SHA_2, environment)).toBe(batch.id);
      expect(await batches.acceptedBatchAt(SHA_2, "another environment")).toBeNull();
    });

    it("keeps what a batch was recorded against, and never accepts a dirty one", async () => {
      const environment = "dirty";
      const storyFilter = { patterns: ["a*", "typo*"], unmatched: ["typo*"] };
      const batch = await batches.beginBatch({
        gitSha: SHA_2,
        environment,
        scale: 1, viewport: { width: 1200, height: 900 },
        dirty: true,
        storyFilter,
      });
      expect(batch).toMatchObject({ dirty: true, storyFilter });
      await batches.recordRenders(batch.id, [rendered("a", 9)]);
      expect(await batches.finishBatch(batch.id, 1)).toMatchObject({ dirty: true, storyFilter });
      expect(await batches.getBatch(batch.id)).toMatchObject({ dirty: true, storyFilter });
      await batches.decide({ on: ON,
        environment,
        decision: "approved",
        actor: "ned",
        renders: [{ story: "a", imageHash: hashOf(9) }],
      });
      await expect(batches.acceptBatch(batch.id, null, 0)).rejects.toMatchObject({ code: "batch-dirty" });
      expect(await batches.acceptedBatchAt(SHA_2, environment)).toBeNull();

      const clean = await batches.beginBatch({ gitSha: SHA_2, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      expect(clean).toMatchObject({ dirty: false, storyFilter: null });
      expect(await batches.getBatch(clean.id)).toMatchObject({ dirty: false, storyFilter: null });
    });

    it("keeps a batch's scale, whole or not", async () => {
      for (const scale of [1, 1.5, 2]) {
        const batch = await batches.beginBatch({ gitSha: SHA_0, environment: "scaled", scale, viewport: { width: 1200, height: 900 }, dirty: false, });
        expect(batch.scale).toBe(scale);
        expect((await batches.getBatch(batch.id))?.scale).toBe(scale);
        expect((await batches.finishBatch(batch.id, 0)).scale).toBe(scale);
        expect((await batches.compareBatch(batch.id, null)).batch.scale).toBe(scale);
      }
    });

    it("keeps the window a batch laid out in, and only the stories that differ from it", async () => {
      const viewport = { width: 640, height: 480 };
      const batch = await batches.beginBatch({ gitSha: SHA_0, environment: "sized", scale: 1, viewport, dirty: false });
      expect((await batches.getBatch(batch.id))?.viewport).toEqual(viewport);
      const phone = { width: 414, height: 896 };
      await batches.recordRenders(batch.id, [{ story: "a", failure: "boom", viewport: phone }, { story: "b", failure: "boom" }]);
      expect(await batches.storyViewportsOf(batch.id)).toEqual({ a: phone });
      expect((await batches.finishBatch(batch.id, 2)).viewport).toEqual(viewport);
      await expect(batches.beginBatch({ gitSha: SHA_0, environment: "sized", scale: 1, viewport: { width: 0, height: 480 }, dirty: false })).rejects.toThrow(RangeError);
    });

    it("fits a whole statement of renders with a window of their own, past what one statement holds", async () => {
      const batch = await batches.beginBatch({ gitSha: SHA_0, environment: "sized-many", scale: 1, viewport: { width: 640, height: 480 }, dirty: false });
      const renders = Array.from({ length: 100 }, (_, i) => ({ story: `story--${i}`, failure: "boom", viewport: { width: 100 + i, height: 200 + i } }));
      await batches.recordRenders(batch.id, renders);
      expect(await batches.storyViewportsOf(batch.id)).toEqual(Object.fromEntries(renders.map(({ story, viewport }) => [story, viewport])));
    });

    it("compares with a finished batch in its environment, and refuses any other", async () => {
      const environment = "against-a-batch";
      const begin = (env = environment) => batches.beginBatch({ gitSha: SHA_0, environment: env, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const finished = async (env: string | undefined, rows: readonly RecordedRender[]) => {
        const batch = await begin(env);
        await batches.recordRenders(batch.id, rows);
        return batches.finishBatch(batch.id, rows.length);
      };
      const first = await finished(undefined, [rendered("a", 1), rendered("b", 2), rendered("gone", 4)]);
      const second = await finished(undefined, [rendered("a", 1), rendered("b", 3), rendered("fresh", 5)]);

      const { renders: compared, unchangedCount } = await batches.compareWithBatch(second.id, first.id);
      expect(unchangedCount).toBe(1);
      expect(compared.map(({ story, state, goldenHash }) => [story, state, goldenHash])).toEqual([
        ["b", "changed", hashOf(2)],
        ["fresh", "added", null],
        ["gone", "removed", hashOf(4)],
      ]);

      const elsewhere = await finished("against-a-batch-elsewhere", [rendered("a", 1)]);
      const recording = await begin();
      for (const baseline of [elsewhere.id, recording.id, "00000000-0000-4000-8000-000000000000"]) {
        await expect(batches.compareWithBatch(second.id, baseline)).rejects.toMatchObject({ code: "no-baseline-batch" });
      }
    });

    it("keeps which batch really rendered a batch's images, and which didn't", async () => {
      const environment = "reused";
      const rendered_ = await batches.beginBatch({ gitSha: SHA_0, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      expect(rendered_.reusedFromBatch).toBeNull();
      expect((await batches.getBatch(rendered_.id))?.reusedFromBatch).toBeNull();

      const reused = await batches.beginBatch({
        gitSha: SHA_1,
        environment,
        scale: 1, viewport: { width: 1200, height: 900 },
        dirty: false,
        reusedFromBatch: rendered_.id,
      });
      expect(reused.reusedFromBatch).toBe(rendered_.id);
      await batches.recordRenders(reused.id, [rendered("a", 11)]);
      expect((await batches.finishBatch(reused.id, 1)).reusedFromBatch).toBe(rendered_.id);
      expect((await batches.getBatch(reused.id))?.reusedFromBatch).toBe(rendered_.id);
      expect((await batches.batchesAt(SHA_1, environment))[0]?.reusedFromBatch).toBe(rendered_.id);
      expect((await batches.compareBatch(reused.id, null)).batch.reusedFromBatch).toBe(rendered_.id);
    });

    it("keeps the image of a story that failed after rendering, and lists it as failed", async () => {
      const environment = "play";
      const batch = await batches.beginBatch({ gitSha: SHA_0, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const played = [
        { ...rendered("a", 10), failure: "play: threw" },
        rendered("b", 11),
        { story: "c", failure: "Render threw" },
      ];
      await batches.recordRenders(batch.id, played);
      await batches.finishBatch(batch.id, 3);
      const first = await batches.compareBatch(batch.id, null);
      expect(first.renders.map(({ story, state, imageHash, failure }) => [story, state, imageHash, failure])).toEqual([
        ["a", "failed", hashOf(10), "play: threw"],
        ["b", "added", hashOf(11), null],
        ["c", "failed", null, "Render threw"],
      ]);

      const golden = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const clean = [rendered("a", 10), rendered("b", 11)];
      await batches.recordRenders(golden.id, clean);
      await batches.finishBatch(golden.id, 2);
      await batches.decide({ on: ON,
        environment,
        decision: "approved",
        actor: "ned",
        renders: clean.map(({ story, imageHash }) => ({ story, imageHash: imageHash! })),
      });
      expect(await batches.acceptBatch(golden.id, null, 0)).toBe(true);

      const next = await batches.beginBatch({ gitSha: SHA_2, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(next.id, [played[0]!, played[1]!]);
      await batches.finishBatch(next.id, 2);
      const compared = await batches.compareBatch(next.id, SHA_1);
      expect(compared.unchangedCount).toBe(1);
      expect(compared.renders.map(({ story, state }) => [story, state])).toEqual([["a", "failed"]]);
    });

    it("fits a whole statement of the longest failures", async () => {
      const environment = "long-play";
      const batch = await batches.beginBatch({ gitSha: SHA_0, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      const count = 100;
      const long = "x".repeat(2_000);
      await batches.recordRenders(
        batch.id,
        Array.from({ length: count }, (_, i) => ({ story: `s${i}`, failure: long })),
      );
      expect(await batches.finishBatch(batch.id, count)).toMatchObject({ status: "failed", failedCount: count });
      const { renders: compared } = await batches.compareBatch(batch.id, null);
      expect(compared).toHaveLength(count);
      expect(compared[0]).toMatchObject({ failure: long });
    });

    it("finds the nearest SHA with goldens, in the order asked, across query groups", async () => {
      const environment = "shared";
      const shas = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(40, "f"));
      expect(await batches.firstWithGoldens(shas, environment)).toBeNull();
      expect(await batches.firstWithGoldens([...shas, SHA_0], environment)).toBe(SHA_0);
      expect(await batches.firstWithGoldens([SHA_0, ...shas], "no-such-environment")).toBeNull();
      expect(await batches.firstWithGoldens([], environment)).toBeNull();
    });

    describe("from another store", () => {
      const received = (environment: string) => ({
        id: crypto.randomUUID(),
        gitSha: SHA_0,
        environment,
        startedAt: 1_000,
        dirty: false,
        storyFilter: null,
        reusedFromBatch: null,
        scale: 2, viewport: { width: 1200, height: 900 },
      });
      const on = (decision: "approved" | "rejected", actor: string, at: number) => ({ story: "a", imageHash: hashOf(1), decision, actor, at, gitSha: ON.gitSha, batchId: ON.batchId });
      const decisionsOn = async (batchId: string) => (await batches.readBatch(batchId)).renders[0]?.decision;
      const finished = async (environment: string, items: readonly RecordedRender[] = [rendered("a", 1)], finishedAt?: number) => {
        const batch = received(environment);
        await batches.receiveBatch(batch);
        await batches.recordRenders(batch.id, items);
        await batches.finishBatch(batch.id, items.length, finishedAt);
        return batch;
      };

      it("keeps a batch's identity and its times", async () => {
        const batch = received("received-batch");
        expect(await batches.receiveBatch(batch)).toMatchObject({ ...batch, status: "recording", finishedAt: null });
        await batches.recordRenders(batch.id, [rendered("a", 1)]);
        expect(await batches.finishBatch(batch.id, 1, 2_000)).toMatchObject({ id: batch.id, status: "complete", startedAt: 1_000, finishedAt: 2_000 });
      });

      it("says how far a batch got when it's sent again, and refuses a different one under its ID", async () => {
        const batch = await finished("received-again", undefined, 2_000);
        expect(await batches.receiveBatch(batch)).toMatchObject({ status: "complete", finishedAt: 2_000 });
        await expect(batches.receiveBatch({ ...batch, gitSha: SHA_1 })).rejects.toMatchObject({ code: "batch-conflict" });
        await expect(batches.receiveBatch({ ...batch, viewport: { width: 1, height: 1 } })).rejects.toMatchObject({ code: "batch-conflict" });
      });

      it("reads back what a batch holds, in pages, with what's been decided", async () => {
        const batch = await finished("read-back", [rendered("a", 1), rendered("b", 2), { story: "c", failure: "boom" }, { ...rendered("d", 3), failure: "threw" }]);
        await batches.mergeDecisions("read-back", [on("approved", "ned", 1_000)]);
        const first = await batches.readBatch(batch.id, "", 3);
        expect(first.renders).toEqual([
          { story: "a", imageHash: hashOf(1), decision: { decision: "approved", actor: "ned", at: 1_000, gitSha: ON.gitSha, batchId: ON.batchId } },
          { story: "b", imageHash: hashOf(2), decision: null },
          { story: "c", failure: "boom", decision: null },
        ]);
        expect(first.next).toBe("c");
        const second = await batches.readBatch(batch.id, first.next!, 3);
        expect(second.renders).toEqual([{ story: "d", imageHash: hashOf(3), failure: "threw", decision: null }]);
        expect(second.next).toBeNull();
      });

      it("says what accepting would remove, against goldens or against nothing", async () => {
        const batch = await finished("removes", [rendered("a", 1), rendered("b", 2)]);
        await batches.adoptGoldens(batch.id);
        const next = await finished("removes", [rendered("a", 1)]);
        expect(await batches.removedFrom(next.id, SHA_0)).toEqual(["b"]);
        expect(await batches.removedFrom(next.id, null)).toEqual([]);
      });

      it("won't read a batch that hasn't finished", async () => {
        const batch = received("read-unfinished");
        await batches.receiveBatch(batch);
        await expect(batches.readBatch(batch.id)).rejects.toMatchObject({ code: "batch-not-finished" });
      });

      it("lets the latest decision win, whichever order they arrive in", async () => {
        const [older, newer] = [on("rejected", "bob", 1_000), on("approved", "ned", 2_000)];
        for (const [environment, order] of [["merge-forward", [older, newer]], ["merge-backward", [newer, older]]] as const) {
          const batch = await finished(environment);
          for (const decision of order) await batches.mergeDecisions(environment, [decision]);
          expect(await decisionsOn(batch.id)).toEqual({ decision: "approved", actor: "ned", at: 2_000, gitSha: ON.gitSha, batchId: ON.batchId });
        }
      });

      it("settles the same moment the same way in either order, with a rejection winning", async () => {
        const [approval, rejection] = [on("approved", "ned", 1_000), on("rejected", "bob", 1_000)];
        for (const [environment, order] of [["tie-forward", [approval, rejection]], ["tie-backward", [rejection, approval]]] as const) {
          const batch = await finished(environment);
          for (const decision of order) await batches.mergeDecisions(environment, [decision]);
          expect((await decisionsOn(batch.id))?.decision).toBe("rejected");
        }
      });

      it("doesn't change whose a decision is when it's sent back", async () => {
        const batch = await finished("sent-back");
        await batches.mergeDecisions("sent-back", [on("approved", "alice", 1_000)]);
        await batches.mergeDecisions("sent-back", [on("approved", "zed", 1_000)]);
        expect(await decisionsOn(batch.id)).toEqual({ decision: "approved", actor: "alice", at: 1_000, gitSha: ON.gitSha, batchId: ON.batchId });
      });

      it("merges more decisions than one statement holds, and a resend changes nothing", async () => {
        const many = Array.from({ length: 45 }, (_, i) => ({ ...on("approved", "ned", 1_000), story: `s${i}` }));
        await over(replaying).mergeDecisions("merge-many", many);
        const batch = await finished("merge-many", many.map(({ story }) => rendered(story, 1)));
        const { renders: read } = await batches.readBatch(batch.id);
        expect(read.every(({ decision }) => decision?.decision === "approved")).toBe(true);
      });

      it("adopts goldens with no decisions, replacing what was there", async () => {
        const environment = "adopted";
        const first = await finished(environment, [rendered("a", 1)]);
        const second = await finished(environment, [rendered("a", 2)]);
        await over(replaying).adoptGoldens(first.id);
        expect(await batches.acceptedBatchAt(SHA_0, environment)).toBe(first.id);
        await batches.adoptGoldens(second.id);
        expect(await batches.acceptedBatchAt(SHA_0, environment)).toBe(second.id);
      });

      it("won't adopt what can't be goldens", async () => {
        const dirty = received("adopt-refused");
        await batches.receiveBatch({ ...dirty, dirty: true });
        await expect(batches.adoptGoldens(dirty.id)).rejects.toMatchObject({ code: "batch-not-finished" });
        await batches.recordRenders(dirty.id, [rendered("a", 1)]);
        await batches.finishBatch(dirty.id, 1);
        await expect(batches.adoptGoldens(dirty.id)).rejects.toMatchObject({ code: "batch-dirty" });
        const failed = await finished("adopt-refused", [{ story: "a", failure: "boom" }]);
        await expect(batches.adoptGoldens(failed.id)).rejects.toMatchObject({ code: "batch-has-failures" });
        expect(await batches.acceptedBatchAt(SHA_0, "adopt-refused")).toBeNull();
      });
    });

    it("refuses an acceptance that would drop goldens the reviewer didn't see", async () => {
      // The rerun lacks d, and the reviewer says nothing was removed.
      await expect(batches.acceptBatch(rerun, SHA_0, 0)).rejects.toMatchObject({
        code: "wrong-removed-count",
        message: expect.stringContaining("would remove 1 goldens, not the 0"),
      });
    });
  });
}
