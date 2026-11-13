import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  imageInsertStatement,
  initStoreSchema,
  RenderBatches,
  decisionsThatCount,
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

    /** The baseline at `SHA_0`: a batch of A to D, approved as a whole. */
    const BASELINE = [rendered("a", 1), rendered("b", 2), rendered("c", 3), rendered("d", 4)];
    let baseline: string;
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

      const first = await batches.beginBatch({ gitSha: SHA_0, environment: "shared", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      baseline = first.id;
      await batches.recordRenders(baseline, BASELINE);
      await batches.finishBatch(baseline, BASELINE.length);
      await batches.decide({ on: ON,
        environment: "shared",
        decision: "approved",
        actor: "ned",
        renders: BASELINE.map((render) => ({ story: render.story, imageHash: render.imageHash! })),
      });

      // Against that baseline: a is unchanged, b changed, c failed, d removed, and e new.
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
      const { batch, renders: compared, unchangedCount } = await batches.compareWithBatch(headBatch, baseline);
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
      const head = await batches.compareWithBatch(headBatch, baseline);
      expect(head.renders[0]).toMatchObject({
        story: "b",
        imageHash: hashOf(5),
        decision: { decision: "approved", actor: "ned", at: expect.any(Number) },
      });
      const again = await batches.compareWithBatch(rerun, baseline, { includeUnchanged: true });
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
      // That baseline has the same image for the same story, in another environment.
      await expect(batches.compareWithBatch(other.id, baseline)).rejects.toMatchObject({ code: "no-baseline-batch" });
      // Approved in "shared" and not here, so a decision doesn't cross either.
      expect(await batches.decisionsAt("other", [ON.gitSha])).toEqual([]);
      const { renders: compared } = await batches.compareFromHistory(other.id, await batches.decisionsAt("other", [ON.gitSha]));
      expect(compared).toMatchObject([{ story: "a", state: "added", decision: null }]);
      const here = await batches.beginBatch({ gitSha: SHA_0, environment: "other", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(here.id, [rendered("a", 2)]);
      await batches.finishBatch(here.id, 1);
      expect((await batches.compareWithBatch(other.id, here.id)).renders).toMatchObject([{ story: "a", state: "changed", decision: null }]);
    });

    it("leaves a crashed batch recording, beside the new batch that replaces it", async () => {
      const environment = "crash";
      const crashed = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(crashed.id, [rendered("a", 1)]);

      const dying = over((adapter) => failing(adapter, () => true));
      await expect(dying.recordRenders(crashed.id, [rendered("b", 2)])).rejects.toThrow("Simulated");

      await expect(batches.finishBatch(crashed.id, 2)).rejects.toMatchObject({ code: "wrong-render-count" });
      await expect(batches.compareFromHistory(crashed.id, [])).rejects.toMatchObject({ code: "batch-not-finished" });
      await expect(batches.compareWithBatch(crashed.id, baseline)).rejects.toMatchObject({ code: "batch-not-finished" });

      const fresh = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(fresh.id, [rendered("a", 1), rendered("b", 2)]);
      expect(await batches.finishBatch(fresh.id, 2)).toMatchObject({ status: "complete", failedCount: 0 });
    });

    it("survives writes being resent, and ends with a complete batch", async () => {
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
      const decisions = await batches.decisionsAt(environment, [ON.gitSha]);
      expect(decisions).toHaveLength(1);
      expect(await replayed.compareFromHistory(batch.id, decisions, { includeUnchanged: true })).toMatchObject({ renders: [{ story: "a", state: "unchanged" }], unchangedCount: 1 });
      expect(await batches.decisionsAt("another environment", [ON.gitSha])).toEqual([]);
    });

    it("keeps what a batch was recorded against", async () => {
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

      const clean = await batches.beginBatch({ gitSha: SHA_2, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      expect(clean).toMatchObject({ dirty: false, storyFilter: null });
      expect(await batches.getBatch(clean.id)).toMatchObject({ dirty: false, storyFilter: null });
    });

    it("compares with what a commit reaches by the graph it was told, through every parent", async () => {
      const [merged, left, right, root, unrelated] = ["a", "b", "c", "d", "9"].map((digit) => digit!.repeat(40)) as [string, string, string, string, string];
      await batches.recordCommits([{ sha: merged, parents: [left, right] }, { sha: right, parents: [root] }, { sha: left, parents: [root] }, { sha: root, parents: [] }]);
      await batches.recordCommits([{ sha: merged, parents: [left, right] }]);
      const environment = "reached";
      const batch = await batches.beginBatch({ gitSha: merged, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false });
      await batches.recordRenders(batch.id, [rendered("through-a-merge", 1), rendered("elsewhere", 2), rendered("no-decision", 3)]);
      await batches.finishBatch(batch.id, 3);
      const decision = { decision: "approved" as const, actor: "ned", at: 1, batchId: ON.batchId };
      await batches.mergeDecisions(environment, [{ story: "through-a-merge", imageHash: hashOf(1), gitSha: right, ...decision }, { story: "elsewhere", imageHash: hashOf(2), gitSha: unrelated, ...decision }]);
      const { renders } = await batches.compareReached(batch.id, { includeUnchanged: true });
      expect(renders.map(({ story, state }) => [story, state])).toEqual([["elsewhere", "added"], ["no-decision", "added"], ["through-a-merge", "unchanged"]]);
    });

    it("finds the newest finished batch on a branch, or anywhere", async () => {
      const on = (branch: string) => batches.beginBatch({ gitSha: SHA_0, environment: "newest", scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, branch });
      const finishedOnTopic = await on("topic-newest");
      await batches.finishBatch(finishedOnTopic.id, 0);
      await on("topic-newest");
      expect((await batches.newestFinished("topic-newest"))?.id).toBe(finishedOnTopic.id);
      expect(await batches.newestFinished("no-such-branch")).toBeNull();
      expect((await batches.newestFinished())?.id).toBe(finishedOnTopic.id);
    });

    it("keeps a batch's scale, whole or not", async () => {
      for (const scale of [1, 1.5, 2]) {
        const batch = await batches.beginBatch({ gitSha: SHA_0, environment: "scaled", scale, viewport: { width: 1200, height: 900 }, dirty: false, });
        expect(batch.scale).toBe(scale);
        expect((await batches.getBatch(batch.id))?.scale).toBe(scale);
        expect((await batches.finishBatch(batch.id, 0)).scale).toBe(scale);
        expect((await batches.compareFromHistory(batch.id, [])).batch.scale).toBe(scale);
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
      expect((await batches.compareFromHistory(reused.id, [])).batch.reusedFromBatch).toBe(rendered_.id);
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
      const first = await batches.compareFromHistory(batch.id, []);
      expect(first.renders.map(({ story, state, imageHash, failure }) => [story, state, imageHash, failure])).toEqual([
        ["a", "failed", hashOf(10), "play: threw"],
        ["b", "added", hashOf(11), null],
        ["c", "failed", null, "Render threw"],
      ]);

      const clean = await batches.beginBatch({ gitSha: SHA_1, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(clean.id, [rendered("a", 10), rendered("b", 11)]);
      await batches.finishBatch(clean.id, 2);

      const next = await batches.beginBatch({ gitSha: SHA_2, environment, scale: 1, viewport: { width: 1200, height: 900 }, dirty: false, });
      await batches.recordRenders(next.id, [played[0]!, played[1]!]);
      await batches.finishBatch(next.id, 2);
      const compared = await batches.compareWithBatch(next.id, clean.id);
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
      const { renders: compared } = await batches.compareFromHistory(batch.id, []);
      expect(compared).toHaveLength(count);
      expect(compared[0]).toMatchObject({ failure: long });
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
      const decisionsOn = async (batchId: string) => {
        const { environment } = (await batches.getBatch(batchId))!;
        const [newest] = decisionsThatCount(await batches.decisionsAt(environment, [ON.gitSha, SHA_0, SHA_1]));
        if (newest === undefined) return null;
        const { decision, actor, at, gitSha, batchId: madeOn } = newest;
        return { decision, actor, at, gitSha, batchId: madeOn };
      };
      const finished = async (environment: string, items: readonly RecordedRender[] = [rendered("a", 1)], finishedAt?: number) => {
        const batch = received(environment);
        await batches.receiveBatch(batch);
        await batches.recordRenders(batch.id, items);
        await batches.finishBatch(batch.id, items.length, finishedAt);
        return batch;
      };

      it("reaches the commits of its branch's earlier batches since its branch began, as a review with Git does, but not their history", async () => {
        const environment = "branch-reached";
        const [root, before, rebasedAway, newBase, head, elsewhere] = ["b0", "b1", "b2", "b3", "b4", "b5"].map((tag) => tag.padEnd(40, "f")) as [string, string, string, string, string, string];
        // `rebasedAway` was the branch's head, and the rebase left it, and `before` under it, out of `head`'s history.
        await batches.recordCommits([{ sha: before, parents: [root] }, { sha: rebasedAway, parents: [before] }, { sha: newBase, parents: [root] }, { sha: head, parents: [newBase] }]);
        const receive = async (gitSha: string, startedAt: number, branch: string | null, branchBegan?: number, env = environment) => {
          const batch = { ...received(env), gitSha, startedAt, branch, ...(branchBegan === undefined ? {} : { branchBegan }) };
          await batches.receiveBatch(batch);
          await batches.recordRenders(batch.id, [rendered("old-work", 1), rendered("rebased", 2), rendered("before", 3), rendered("elsewhere", 4)]);
          await batches.finishBatch(batch.id, 4);
          return batch;
        };
        const oldWork = await receive(elsewhere, 1_000, "topic");
        const onRebasedAway = await receive(rebasedAway, 2_000, "topic");
        const inAnotherEnvironment = await receive(elsewhere, 2_500, "topic", undefined, "branch-reached-elsewhere");
        const decision = { decision: "approved" as const, actor: "ned", at: 1 };
        await batches.mergeDecisions(environment, [
          { story: "old-work", imageHash: hashOf(1), gitSha: elsewhere, batchId: oldWork.id, ...decision },
          { story: "rebased", imageHash: hashOf(2), gitSha: rebasedAway, batchId: onRebasedAway.id, ...decision },
          { story: "before", imageHash: hashOf(3), gitSha: before, batchId: ON.batchId, ...decision },
        ]);
        await batches.mergeDecisions("branch-reached-elsewhere", [{ story: "elsewhere", imageHash: hashOf(4), gitSha: elsewhere, batchId: inAnotherEnvironment.id, ...decision }]);

        const rebased = await receive(head, 3_000, "topic", 1_500);
        const states = async (batchId: string) => statesOf((await batches.compareReached(batchId, { includeUnchanged: true })).renders);
        expect(await states(rebased.id)).toEqual({ "old-work": "added", rebased: "unchanged", before: "added", elsewhere: "added" });
        expect(statesOf((await batches.approvedSinceReached(rebased.id, "main")).current.renders.filter(({ state }) => state !== "unchanged"))).toEqual({ "old-work": "added", before: "added", elsewhere: "added" });
        // Sent again saying something else, it keeps what it was first told, since a batch never changes.
        await batches.receiveBatch({ ...rebased, branchBegan: 0 });
        expect(await states(rebased.id)).toMatchObject({ "old-work": "added", rebased: "unchanged" });

        // From a sender that doesn't say when its branch began, and a detached batch, only history counts.
        for (const [startedAt, branch, began] of [[3_100, "topic", undefined], [3_200, null, 1_500]] as const) {
          expect(await states((await receive(head, startedAt, branch, began)).id)).toMatchObject({ rebased: "added" });
        }
      });

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

      it("reads back what a batch holds, in pages", async () => {
        const batch = await finished("read-back", [rendered("a", 1), rendered("b", 2), { story: "c", failure: "boom" }, { ...rendered("d", 3), failure: "threw" }]);
        const first = await batches.readBatch(batch.id, "", 3);
        expect(first.renders).toEqual([
          { story: "a", imageHash: hashOf(1) },
          { story: "b", imageHash: hashOf(2) },
          { story: "c", failure: "boom" },
        ]);
        expect(first.next).not.toBeNull();
        const second = await batches.readBatch(batch.id, first.next!, 3);
        expect(second.renders).toEqual([{ story: "d", imageHash: hashOf(3), failure: "threw" }]);
        expect(second.next).toBeNull();
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

      it("reads a rejection first at the same moment, across commits", async () => {
        const batch = await finished("tie-across-commits");
        await batches.mergeDecisions("tie-across-commits", [{ ...on("approved", "ned", 1_000), gitSha: SHA_0 }, { ...on("rejected", "bob", 1_000), gitSha: SHA_1 }]);
        const { renders } = await batches.compareWithBatch(batch.id, batch.id, { includeUnchanged: true });
        expect(renders.find(({ story }) => story === "a")?.decision?.decision).toBe("rejected");
        expect((await decisionsOn(batch.id))?.decision).toBe("rejected");
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
        const { renders: read } = await batches.compareWithBatch(batch.id, batch.id, { includeUnchanged: true });
        expect(read.every(({ decision }) => decision?.decision === "approved")).toBe(true);
      });

      it("takes a removal, which reads back as none of any image, and as a removal in a comparison", async () => {
        const environment = "merged-removal";
        const onThis = await finished(environment, [rendered("b", 2)]);
        const approval = on("approved", "ned", 1_000);
        const removal = { ...on("approved", "alice", 2_000), imageHash: null, batchId: onThis.id };
        await over(replaying).mergeDecisions(environment, [approval, removal]);

        const decisions = await batches.decisionsAt(environment, [ON.gitSha]);
        expect(decisions).toHaveLength(2);
        expect(decisions).toContainEqual(removal);
        expect(decisions).toContainEqual(approval);

        // On the batch it was made on, a is removed, and that's approved.
        const { renders } = await batches.compareFromHistory(onThis.id, decisions);
        expect(renders).toEqual([
          { story: "b", state: "added", imageHash: hashOf(2), goldenHash: null, failure: null, decision: null },
          { story: "a", state: "removed", imageHash: null, goldenHash: hashOf(1), goldenBatchId: ON.batchId, failure: null, decision: { decision: "approved", actor: "alice", at: 2_000 } },
        ]);

        // After it, a is gone, and if it comes back it's new.
        const after = await finished(environment, [rendered("b", 2)]);
        expect((await batches.compareFromHistory(after.id, decisions)).renders.map(({ story }) => story)).toEqual(["b"]);
        const back = await finished(environment, [rendered("a", 1)]);
        expect((await batches.compareFromHistory(back.id, decisions)).renders).toMatchObject([{ story: "a", state: "added", goldenHash: null }]);
      });

      it("lets the latest say about a removal win, whichever order they arrive in", async () => {
        const removal = (decision: "approved" | "rejected", actor: string, at: number) => ({ ...on(decision, actor, at), imageHash: null });
        const [older, newer] = [removal("approved", "ned", 1_000), removal("rejected", "bob", 2_000)];
        for (const [environment, order] of [["removal-forward", [older, newer]], ["removal-backward", [newer, older]]] as const) {
          for (const decision of order) await batches.mergeDecisions(environment, [decision]);
          expect(await batches.decisionsAt(environment, [ON.gitSha])).toEqual([newer]);
        }
      });
    });
  });
}
