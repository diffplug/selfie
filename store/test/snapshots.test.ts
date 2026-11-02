import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  imageInsertStatement,
  initStoreSchema,
  Snapshots,
  Sql,
  Store,
  type RecordedSnapshot,
  type SqlAdapter,
  type SqlStatement,
} from "../src/core/index.ts";
import { describeSnapshotContract, failing, replaying } from "./contract/snapshots-contract.ts";
import { pngOf } from "./support/png-builder.ts";
import { hashOf, insertedKey } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";

for (const mode of ["number", "string"] as const) {
  describeSnapshotContract("local SQLite", mode, async () => {
    const temp = await createTempStore();
    return { connect: () => temp.connectAdapter(), destroy: temp.destroy };
  });
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const ENV = "container-linux-arm64-0123456789abcdef";

const rendered = (story: string, image: number): RecordedSnapshot => ({
  story,
  imageHash: hashOf(image),
});

/** Counts requests, the unit D1's shared API limit is spent in. */
function counting(adapter: SqlAdapter) {
  const sent: SqlStatement[][] = [];
  return {
    sent,
    adapter: {
      execute: (statements: readonly SqlStatement[]) => {
        sent.push([...statements]);
        return adapter.execute(statements);
      },
    } satisfies SqlAdapter,
  };
}

describe("Snapshots", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;
  let adapter: SqlAdapter;
  let sql: Sql;
  let snapshots: Snapshots;
  let clock: number;

  const over = (wrap: (adapter: SqlAdapter) => SqlAdapter) =>
    new Snapshots({ sql: new Sql(wrap(adapter)), now: () => clock++ });

  const seedImages = async (count: number, target = sql) => {
    const statements = Array.from({ length: count }, (_, i) =>
      imageInsertStatement(hashOf(i + 1), i + 1),
    );
    await target.batch(statements);
  };

  /** A finished run of these snapshots. */
  const recordRun = async (
    gitSha: string,
    items: readonly RecordedSnapshot[],
    environment = ENV,
    model = snapshots,
  ) => {
    const run = await model.beginRun({ gitSha, environment });
    await model.recordSnapshots(run.id, items);
    return model.finishRun(run.id, items.length);
  };

  const approve = (items: readonly RecordedSnapshot[], environment = ENV, model = snapshots) =>
    model.decide({
      environment,
      decision: "approved",
      actor: "ned",
      snapshots: items.map(({ story, settings, imageHash }) => ({
        story,
        settings,
        imageHash: imageHash!,
      })),
    });

  /** Goldens at this SHA, holding these snapshots. */
  const goldensAt = async (gitSha: string, items: readonly RecordedSnapshot[]) => {
    const run = await recordRun(gitSha, items);
    await approve(items);
    expect(await snapshots.acceptRun(run.id, null)).toBe(true);
    return run;
  };

  const statesOf = async (runId: string, baseline: string | null, model = snapshots) => {
    const { snapshots: compared } = await model.compareRun(runId, baseline);
    return Object.fromEntries(compared.map(({ story, state }) => [story, state]));
  };

  beforeEach(async () => {
    temp = await createTempStore();
    adapter = temp.connectAdapter();
    sql = new Sql(adapter);
    clock = 1_000;
    snapshots = new Snapshots({ sql, now: () => clock++ });
    await seedImages(40);
  });

  afterEach(async () => {
    await temp.destroy();
  });

  describe("names", () => {
    it("treats settings as part of a name", async () => {
      const items: RecordedSnapshot[] = [
        { story: "a", imageHash: hashOf(1) },
        { story: "a", settings: "dark", imageHash: hashOf(2) },
      ];
      await goldensAt(SHA_A, items);
      const run = await recordRun(SHA_B, [
        { story: "a", imageHash: hashOf(1) },
        { story: "a", settings: "dark", imageHash: hashOf(3) },
      ]);
      const { snapshots: compared } = await snapshots.compareRun(run.id, SHA_A);
      expect(compared.map(({ settings, state }) => [settings, state])).toEqual([
        ["", "unchanged"],
        ["dark", "changed"],
      ]);
    });

    it("takes a story ID as opaque, whatever it holds", async () => {
      const stories = ["ui/button--primary", "it's", 'a"b', "--", "\u{1F600}", "123", "(?1)"];
      const run = await recordRun(SHA_A, stories.map((story, i) => rendered(story, i + 1)));
      const listed = await snapshots.listSnapshots(run.id);
      expect(listed.map(({ story }) => story).sort()).toEqual([...stories].sort());
    });

    it("refuses what can't name a snapshot", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      for (const bad of ["", "a\0b"]) {
        await expect(snapshots.recordSnapshots(run.id, [rendered(bad, 1)])).rejects.toThrow(RangeError);
        await expect(snapshots.beginRun({ gitSha: SHA_A, environment: bad })).rejects.toThrow(RangeError);
      }
      await expect(
        snapshots.recordSnapshots(run.id, [{ story: "a", settings: "\0", imageHash: hashOf(1) }]),
      ).rejects.toThrow(RangeError);
      await expect(
        snapshots.recordSnapshots(run.id, [{ story: "a", imageHash: "abc" }]),
      ).rejects.toThrow("Not an image hash");
      await expect(snapshots.recordSnapshots(run.id, [rendered("a", 1), rendered("a", 2)])).rejects.toThrow(
        "recorded twice",
      );
      for (const sha of ["abc123", SHA_A.toUpperCase()]) {
        await expect(snapshots.beginRun({ gitSha: sha, environment: ENV })).rejects.toThrow("Git SHA");
      }
      expect(await snapshots.listSnapshots(run.id)).toEqual([]);
    });
  });

  describe("recording", () => {
    it("takes the newer result for a name, until the run is finished", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      await snapshots.recordSnapshots(run.id, [{ story: "a", failure: "Timeout" }, rendered("b", 1)]);
      await snapshots.recordSnapshots(run.id, [rendered("a", 2), { story: "b", failure: "Crash" }]);
      expect(await snapshots.listSnapshots(run.id)).toEqual([
        { story: "a", settings: "", imageHash: hashOf(2) },
        { story: "b", settings: "", failure: "Crash" },
      ]);
      expect(await snapshots.finishRun(run.id, 2)).toMatchObject({
        status: "failed",
        snapshotCount: 2,
        failedCount: 1,
      });

      await expect(snapshots.recordSnapshots(run.id, [rendered("b", 3)])).rejects.toMatchObject({
        code: "run-finished",
      });
      expect((await snapshots.listSnapshots(run.id))[1]).toEqual({
        story: "b",
        settings: "",
        failure: "Crash",
      });
    });

    it("records a failed story, so it isn't silently absent", async () => {
      const run = await recordRun(SHA_A, [{ story: "a", failure: "" }]);
      expect(run.status).toBe("failed");
      expect(await statesOf(run.id, null)).toEqual({ a: "failed" });
    });

    it("bounds a failure message without splitting a character", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      await snapshots.recordSnapshots(run.id, [{ story: "a", failure: "\0\u{1F600}".repeat(5_000) }]);
      const [listed] = await snapshots.listSnapshots(run.id);
      expect(listed?.failure).toBe("\u{1F600}".repeat(2_000));
    });

    it("refuses an image that isn't stored, and a run that doesn't exist", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      await expect(snapshots.recordSnapshots(run.id, [rendered("a", 9_999)])).rejects.toMatchObject({
        code: "unknown-image",
      });
      await expect(snapshots.recordSnapshots("nope", [rendered("a", 1)])).rejects.toMatchObject({
        code: "unknown-run",
      });
      await expect(snapshots.finishRun("nope", 0)).rejects.toMatchObject({ code: "unknown-run" });
      await expect(snapshots.compareRun("nope", null)).rejects.toMatchObject({ code: "unknown-run" });
      await expect(snapshots.acceptRun("nope", null)).rejects.toMatchObject({ code: "unknown-run" });
      expect(await snapshots.getRun("nope")).toBeNull();
    });

    it("finishes an empty run, and sends nothing for an empty call", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await model.beginRun({ gitSha: SHA_A, environment: ENV });
      await model.recordSnapshots(run.id, []);
      await model.decide({ environment: ENV, decision: "approved", actor: "ned", snapshots: [] });
      expect(sent).toHaveLength(1);
      expect(await model.finishRun(run.id, 0)).toMatchObject({ status: "complete", snapshotCount: 0 });
    });

    it("lists runs at a SHA, crashed ones included, for one environment", async () => {
      const crashed = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      const later = await recordRun(SHA_A, []);
      await recordRun(SHA_A, [], "other");
      await recordRun(SHA_B, []);
      expect((await snapshots.runsAt(SHA_A, ENV)).map(({ id, status }) => [id, status])).toEqual([
        [later.id, "complete"],
        [crashed.id, "recording"],
      ]);
      expect(await snapshots.getRun(crashed.id)).toEqual(crashed);
    });
  });

  describe("crashes partway", () => {
    // 13,200 snapshots fill the 400 statements of one request, so this takes two.
    const SNAPSHOTS = 14_000;
    const items: RecordedSnapshot[] = Array.from({ length: SNAPSHOTS }, (_, i) =>
      rendered(`story-${i}`, (i % 40) + 1),
    );

    it("sends a large run in as few requests as the limits allow", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const run = await model.beginRun({ gitSha: SHA_A, environment: ENV });
      sent.length = 0;
      await model.recordSnapshots(run.id, items);
      expect(sent.map((statements) => statements.length)).toEqual([400, 25]);
    });

    it.each([
      ["nothing landed", 0, 13_200],
      ["its statements landed in part", 10, 13_200 + 10 * 33],
    ])("can resume when a batch dies and %s", async (_, ran, stored) => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      let requests = 0;
      const dying = over((inner) => failing(inner, () => ++requests === 2, ran));

      await expect(dying.recordSnapshots(run.id, items)).rejects.toThrow("Simulated");

      // What a crash leaves: a run that says so, and refuses to be taken for complete.
      expect((await snapshots.getRun(run.id))?.status).toBe("recording");
      await expect(snapshots.finishRun(run.id, SNAPSHOTS)).rejects.toMatchObject({
        code: "wrong-snapshot-count",
        message: expect.stringContaining(`holds ${stored} snapshots`),
      });
      await expect(snapshots.compareRun(run.id, null)).rejects.toMatchObject({
        code: "run-not-finished",
      });
      await expect(snapshots.acceptRun(run.id, null)).rejects.toMatchObject({
        code: "run-not-finished",
      });
      expect(await snapshots.listSnapshots(run.id)).toHaveLength(stored);

      // The resume: everything again, or only what `listSnapshots` shows is missing.
      const held = new Set((await snapshots.listSnapshots(run.id)).map(({ story }) => story));
      await snapshots.recordSnapshots(run.id, items.filter(({ story }) => !held.has(story)));
      expect(await snapshots.finishRun(run.id, SNAPSHOTS)).toMatchObject({
        status: "complete",
        snapshotCount: SNAPSHOTS,
      });
    });

    it("keeps one row per name when a request commits and its response is lost", async () => {
      const run = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      let lost = false;
      const losing = over((inner) => ({
        execute: async (statements) => {
          const rows = await inner.execute(statements);
          if (!lost) {
            lost = true;
            throw new Error("Simulated: the response was lost");
          }
          return rows;
        },
      }));
      await expect(losing.recordSnapshots(run.id, items)).rejects.toThrow("Simulated");
      await losing.recordSnapshots(run.id, items);
      expect(await snapshots.finishRun(run.id, SNAPSHOTS)).toMatchObject({ snapshotCount: SNAPSHOTS });
    });

    it("marks everything idempotent, and gives the same answers when all of it is resent", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = over(() => replaying(counted));
      const golden = await recordRun(SHA_A, [rendered("a", 1), rendered("b", 2)], ENV, model);
      await approve([rendered("a", 1), rendered("b", 2)], ENV, model);
      expect(await model.acceptRun(golden.id, null)).toBe(true);
      const head = await recordRun(
        SHA_B,
        [rendered("a", 1), rendered("b", 3), rendered("c", 4), { story: "d", failure: "Boom" }],
        ENV,
        model,
      );
      const states = await statesOf(head.id, SHA_A, model);
      expect(states).toEqual({ a: "unchanged", b: "changed", c: "new", d: "failed" });
      expect(await model.runsAt(SHA_B, ENV)).toHaveLength(1);
      expect(await model.listSnapshots(head.id)).toHaveLength(4);
      expect(await model.goldens(SHA_A, ENV)).toHaveLength(2);
      expect(await model.hasCompleteGoldens(SHA_A, ENV)).toBe(true);
      expect(await model.getRun(head.id)).toMatchObject({ snapshotCount: 4, failedCount: 1 });

      expect(sent.flat().filter(({ idempotent }) => idempotent !== true)).toEqual([]);
      // Finished at the first send's time, not the second's.
      expect((await snapshots.getRun(head.id))?.finishedAt).toBe(head.finishedAt);
    });
  });

  describe("decisions", () => {
    const decisionOn = async (runId: string, story: string) => {
      const { snapshots: compared } = await snapshots.compareRun(runId, null);
      return compared.find((snapshot) => snapshot.story === story)?.decision;
    };
    const decide = (decision: "approved" | "rejected", actor: string, at: number, image = 1) =>
      snapshots.decide({
        environment: ENV,
        decision,
        actor,
        at,
        snapshots: [{ story: "a", imageHash: hashOf(image) }],
      });

    it("keeps the latest decision, whatever order they arrive in", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await decide("rejected", "bob", 200);
      await decide("approved", "ned", 100);
      expect(await decisionOn(run.id, "a")).toEqual({ decision: "rejected", actor: "bob", at: 200 });
      await decide("approved", "ned", 300);
      expect(await decisionOn(run.id, "a")).toEqual({ decision: "approved", actor: "ned", at: 300 });
    });

    it("settles a tie the same way in either order, with rejection winning", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await decide("rejected", "bob", 200);
      await decide("approved", "ned", 200);
      expect((await decisionOn(run.id, "a"))?.decision).toBe("rejected");
      const other = await recordRun(SHA_B, [rendered("a", 2)]);
      await decide("approved", "ned", 200, 2);
      await decide("rejected", "bob", 200, 2);
      expect((await decisionOn(other.id, "a"))?.decision).toBe("rejected");
    });

    it("carries through a push: no new approval at a new SHA for the same image", async () => {
      await goldensAt(SHA_A, [rendered("a", 1)]);
      const local = await recordRun(SHA_B, [rendered("a", 2)]);
      await approve([rendered("a", 2)]);
      expect(await snapshots.compareRun(local.id, SHA_A)).toMatchObject({
        snapshots: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });

      // A rebase and push: a new SHA, a new run, the same pixels.
      const pushed = await recordRun(SHA_C, [rendered("a", 2)]);
      expect(await snapshots.compareRun(pushed.id, SHA_A)).toMatchObject({
        snapshots: [{ state: "changed", decision: { decision: "approved", actor: "ned" } }],
      });
      expect(await snapshots.acceptRun(pushed.id, SHA_A)).toBe(true);
    });

    it("moves between stores by name and hash, though the image keys differ", async () => {
      const elsewhere = await createTempStore();
      try {
        const remote = new Snapshots({ sql: elsewhere.sql });
        // The same image holds a different key there.
        const key = insertedKey(await elsewhere.sql.run(imageInsertStatement(hashOf(1), 777)));
        const localKey = insertedKey(await sql.run(imageInsertStatement(hashOf(1), 777)));
        expect(key).not.toBe(localKey);

        await snapshots.decide({
          environment: ENV,
          decision: "approved",
          actor: "ned",
          at: 123,
          snapshots: [{ story: "a", imageHash: hashOf(1) }],
        });
        const run = await recordRun(SHA_A, [rendered("a", 1)]);
        const [compared] = (await snapshots.compareRun(run.id, null)).snapshots;
        const carried = compared!;

        // What a sync would send: a name, a hash, who, and when.
        await remote.decide({
          environment: ENV,
          decision: carried.decision!.decision,
          actor: carried.decision!.actor,
          at: carried.decision!.at,
          snapshots: [{ story: carried.story, settings: carried.settings, imageHash: carried.imageHash! }],
        });
        const there = await recordRun(SHA_B, [rendered("a", 1)], ENV, remote);
        expect(await remote.compareRun(there.id, null)).toMatchObject({
          snapshots: [{ decision: { decision: "approved", actor: "ned", at: 123 } }],
        });
        expect(await remote.acceptRun(there.id, null)).toBe(true);
      } finally {
        await elsewhere.destroy();
      }
    });

    it("may be recorded before the image reaches this store", async () => {
      const hash = hashOf(9_999);
      await snapshots.decide({
        environment: ENV,
        decision: "approved",
        actor: "ned",
        snapshots: [{ story: "a", imageHash: hash }],
      });
      await sql.run(imageInsertStatement(hash, 9_999));
      const run = await recordRun(SHA_A, [{ story: "a", imageHash: hash }]);
      expect(await snapshots.acceptRun(run.id, null)).toBe(true);
    });

    it("refuses a malformed hash", async () => {
      await expect(
        snapshots.decide({
          environment: ENV,
          decision: "approved",
          actor: "ned",
          snapshots: [{ story: "a", imageHash: "1" }],
        }),
      ).rejects.toThrow("Not an image hash");
    });
  });

  describe("goldens", () => {
    it("has none until a run is accepted, then has that run's images", async () => {
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(false);
      expect(await snapshots.goldens(SHA_A, ENV)).toBeNull();
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(true);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(false);
      expect(await snapshots.hasCompleteGoldens(SHA_A, "other")).toBe(false);
      expect(await snapshots.goldens(SHA_A, ENV)).toEqual([
        { story: "a", settings: "", imageHash: hashOf(1) },
        { story: "b", settings: "", imageHash: hashOf(2) },
      ]);
    });

    it("accepts what is unchanged or approved, and nothing else", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2), rendered("gone", 3)]);
      const head = await recordRun(SHA_B, [rendered("a", 1), rendered("b", 4), rendered("c", 5)]);

      // Nothing decided on the changed b or the new c.
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);
      await approve([rendered("b", 4)]);
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);

      // Another image for c is approved, and c's own is rejected.
      await approve([rendered("c", 6)]);
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);
      await snapshots.decide({
        environment: ENV,
        decision: "rejected",
        actor: "bob",
        snapshots: [{ story: "c", imageHash: hashOf(5) }],
      });
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(false);

      // Removing a story needs no decision, since no image is being accepted.
      clock += 1;
      await approve([rendered("c", 5)]);
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(true);
      expect(await snapshots.goldens(SHA_B, ENV)).toHaveLength(3);
      expect(await snapshots.hasCompleteGoldens(SHA_B, ENV)).toBe(true);
    });

    it("doesn't take an approval from another environment", async () => {
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)], "other");
      expect(await snapshots.acceptRun(run.id, null)).toBe(false);
    });

    it("refuses a run with failures or still recording, and a baseline with no goldens", async () => {
      const failed = await recordRun(SHA_A, [{ story: "a", failure: "Boom" }]);
      await expect(snapshots.acceptRun(failed.id, null)).rejects.toMatchObject({
        code: "run-has-failures",
      });
      const recording = await snapshots.beginRun({ gitSha: SHA_A, environment: ENV });
      await expect(snapshots.acceptRun(recording.id, null)).rejects.toMatchObject({
        code: "run-not-finished",
      });

      // Approved, so only the missing baseline can stop it, and it must change nothing.
      const run = await recordRun(SHA_A, [rendered("a", 1)]);
      await approve([rendered("a", 1)]);
      await expect(snapshots.acceptRun(run.id, SHA_C)).rejects.toMatchObject({ code: "no-goldens" });
      expect(await snapshots.hasCompleteGoldens(SHA_A, ENV)).toBe(false);
    });

    it("lets a rerun's acceptance replace a SHA's goldens, all at once", async () => {
      await goldensAt(SHA_A, [rendered("a", 1), rendered("b", 2)]);
      const rerun = await recordRun(SHA_A, [rendered("a", 3)]);
      expect(await snapshots.compareRun(rerun.id, SHA_A)).toMatchObject({
        snapshots: [
          { story: "a", state: "changed", goldenHash: hashOf(1) },
          { story: "b", state: "removed", goldenHash: hashOf(2) },
        ],
      });
      await approve([rendered("a", 3)]);
      expect(await snapshots.acceptRun(rerun.id, SHA_A)).toBe(true);
      expect(await snapshots.goldens(SHA_A, ENV)).toEqual([
        { story: "a", settings: "", imageHash: hashOf(3) },
      ]);
    });

    it("doesn't let a resent older acceptance overwrite a newer one", async () => {
      const older = await recordRun(SHA_A, [rendered("a", 1)]);
      const newer = await recordRun(SHA_A, [rendered("a", 2)]);
      await approve([rendered("a", 1)]);
      await approve([rendered("a", 2)]);
      const stale = new Snapshots({ sql, now: () => 10 });
      expect(await snapshots.acceptRun(newer.id, null)).toBe(true);
      expect(await stale.acceptRun(older.id, null)).toBe(false);
      expect(await snapshots.goldens(SHA_A, ENV)).toEqual([
        { story: "a", settings: "", imageHash: hashOf(2) },
      ]);
    });
  });

  describe("compare", () => {
    it("compares images with colliding truncated hashes by their full hash", async () => {
      const a = hashOf(50_001);
      const b = hashOf(50_002);
      await sql.batch([imageInsertStatement(a, 500), imageInsertStatement(b, 500)]);
      await goldensAt(SHA_A, [{ story: "x", imageHash: a }]);
      const head = await recordRun(SHA_B, [{ story: "x", imageHash: b }]);
      expect(await statesOf(head.id, SHA_A)).toEqual({ x: "changed" });
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);
      await approve([{ story: "x", imageHash: a }]);
      expect(await snapshots.acceptRun(head.id, SHA_A)).toBe(false);
    });

    it("uses images a real Store put", async () => {
      const store = new Store({ sql, blob: temp.blob });
      const files = [1, 2].map((v) =>
        pngOf({ width: 1, height: 1, pixels: new Uint8Array([v, 0, 0]) }),
      );
      const [one, two] = await store.putImages(files);
      await goldensAt(SHA_A, [{ story: "x", imageHash: one!.hash }]);
      const head = await recordRun(SHA_B, [{ story: "x", imageHash: two!.hash }]);
      const { snapshots: compared } = await snapshots.compareRun(head.id, SHA_A);
      expect(compared).toMatchObject([
        { state: "changed", imageHash: two!.hash, goldenHash: one!.hash },
      ]);
    });

    it("reads every page, however the rows fall across them", async () => {
      // Exactly one page of compared snapshots, and more than one of removed ones.
      const PAGE = 5_000;
      const golden = Array.from({ length: PAGE + 5_500 }, (_, i) =>
        rendered(`old-${String(i).padStart(5, "0")}`, (i % 40) + 1),
      );
      await goldensAt(SHA_A, golden);
      const run = await recordRun(SHA_B, golden.slice(0, PAGE));
      const { snapshots: compared } = await snapshots.compareRun(run.id, SHA_A);
      expect(compared.filter(({ state }) => state === "unchanged")).toHaveLength(PAGE);
      expect(compared.filter(({ state }) => state === "removed")).toHaveLength(5_500);
      expect(new Set(compared.map(({ story }) => story)).size).toBe(PAGE + 5_500);
      expect(await snapshots.listSnapshots(run.id)).toHaveLength(PAGE);
    });
  });

  describe("schema", () => {
    it("adds its tables to a store that holds only images, and can run again", async () => {
      const elsewhere = await createTempStore();
      try {
        await elsewhere.sql.batch(
          ["runs", "run_snapshots", "decisions", "goldens"].map((table) => ({
            sql: `DROP TABLE ${table}`,
          })),
        );
        await elsewhere.sql.run(imageInsertStatement(hashOf(1), 1));
        await initStoreSchema(elsewhere.sql);
        await initStoreSchema(elsewhere.sql);
        const model = new Snapshots({ sql: elsewhere.sql });
        const run = await recordRun(SHA_A, [rendered("a", 1)], ENV, model);
        expect(run.status).toBe("complete");
      } finally {
        await elsewhere.destroy();
      }
    });
  });

  describe("at scale", () => {
    const N = 10_000;
    const pad = (i: number) => `component-${String(i).padStart(5, "0")}--story`;

    /** Quicker than a statement per image. */
    const seedMany = (start: number, count: number) => {
      const db = new DatabaseSync(temp.path);
      try {
        const insert = db.prepare("INSERT OR IGNORE INTO images(key, hash) VALUES (?, ?)");
        db.exec("BEGIN");
        for (let i = start; i < start + count; i++) insert.run(i, hashOf(i));
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    };

    it("records, compares, and accepts 10,000 snapshots in few requests", { timeout: 120_000 }, async () => {
      seedMany(1_000_000, N + 1_000);
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const report: Record<string, { ms: number; requests: number; statements: number }> = {};
      const measure = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        sent.length = 0;
        const start = performance.now();
        const result = await work();
        report[name] = {
          ms: Math.round(performance.now() - start),
          requests: sent.length,
          statements: sent.flat().length,
        };
        return result;
      };

      const goldenItems = Array.from({ length: N }, (_, i) => rendered(pad(i), 1_000_000 + i));
      const golden = await measure("beginRun", () => model.beginRun({ gitSha: SHA_A, environment: ENV }));
      await measure("recordSnapshots", () => model.recordSnapshots(golden.id, goldenItems));
      await measure("finishRun", () => model.finishRun(golden.id, N));
      await measure("decide (all)", () => approve(goldenItems, ENV, model));
      const accepted = await measure("acceptRun (all approved)", () => model.acceptRun(golden.id, null));
      expect(accepted).toBe(true);

      // 100 changed, 50 failed, and 50 removed, with 50 new, and the rest unchanged.
      const head: RecordedSnapshot[] = goldenItems.slice(0, N - 50).map((item, i) =>
        i < 100
          ? rendered(item.story, 1_000_000 + N + i)
          : i < 150
            ? { story: item.story, failure: "Render threw" }
            : item,
      );
      for (let i = 0; i < 50; i++) head.push(rendered(`zz-new-${i}`, 1_000_000 + N + 500 + i));
      const run = await measure("beginRun (head)", () => model.beginRun({ gitSha: SHA_B, environment: ENV }));
      await measure("recordSnapshots (head)", () => model.recordSnapshots(run.id, head));
      const finished = await measure("finishRun (head)", () => model.finishRun(run.id, head.length));
      expect(finished.failedCount).toBe(50);

      const { snapshots: compared } = await measure("compareRun", () => model.compareRun(run.id, SHA_A));
      const counts: Record<string, number> = {};
      for (const { state } of compared) counts[state] = (counts[state] ?? 0) + 1;
      expect(counts).toEqual({ unchanged: N - 200, changed: 100, failed: 50, new: 50, removed: 50 });

      await measure("hasCompleteGoldens", () => model.hasCompleteGoldens(SHA_A, ENV));
      await measure("listSnapshots", () => model.listSnapshots(run.id));
      await measure("goldens", () => model.goldens(SHA_A, ENV));

      console.log(`Snapshot model at ${N} snapshots:`);
      console.table(report);

      expect(report.recordSnapshots!.requests).toBe(1);
      expect(report["decide (all)"]!.requests).toBe(1);
      expect(report["acceptRun (all approved)"]!.requests).toBe(1);
      // 10,000 rows at 5,000 per page, and one more that finds none.
      expect(report.compareRun!.requests).toBe(3);
    });

    it("never scans a table, for anything a review sends", async () => {
      const { adapter: counted, sent } = counting(adapter);
      const model = new Snapshots({ sql: new Sql(counted) });
      const items = [rendered("a", 1), rendered("b", 2)];
      const golden = await recordRun(SHA_A, items, ENV, model);
      await approve(items, ENV, model);
      await model.acceptRun(golden.id, null);
      const head = await recordRun(SHA_B, [rendered("a", 3), { story: "c", failure: "Boom" }], ENV, model);
      await model.compareRun(head.id, SHA_A);
      await model.acceptRun(head.id, SHA_A).catch(() => {});
      await model.listSnapshots(head.id);
      await model.runsAt(SHA_A, ENV);
      await model.hasCompleteGoldens(SHA_A, ENV);
      await model.goldens(SHA_A, ENV);
      await model.getRun(head.id);
      await model.finishRun(head.id, 2);
      await model.finishRun(head.id, 99).catch(() => {});

      const db = new DatabaseSync(temp.path);
      try {
        const seen = new Set<string>();
        const scans = sent.flat().flatMap(({ sql: text, params = [] }) => {
          seen.add(text);
          const plan = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params);
          return plan
            .map(({ detail }) => String(detail))
            // Reading a statement's own VALUES, or a one-row aggregate, is no table scan.
            .filter((detail) => /\bSCAN\b/.test(detail) && !/\bSCAN (v|c|\d+ CONSTANT ROWS?|CONSTANT ROW)\b/.test(detail))
            .map((detail) => `${detail} in ${text}`);
        });
        expect(seen.size).toBeGreaterThan(10);
        expect(scans).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
