import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { BLUE, commit, git, GREEN, RED } from "./support.ts";
import { UNKNOWN_HASH, h, project, review, get, change, decideOn, viewOf, approveAll } from "./ui-support.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

describe("approve and reject", () => {
  let batchId: string;
  let rows: any[];
  const target = (story: string) => {
    const { imageHash } = rows.find((row) => row.story === story);
    return { story, imageHash };
  };
  beforeEach(async () => {
    h.stories = [{ id: "a" }, { id: "b", color: BLUE }, { id: "c", color: GREEN }];
    await approveAll();
    await commit(h.repo, "next");
    h.stories = [{ id: "a", color: GREEN }, { id: "b", color: RED }, { id: "c", failed: "broke" }, { id: "d" }];
    ({ batchId } = (await review()).json);
    ({ rows } = await viewOf(batchId));
  });

  test("records exactly the images asked for, as Git's user, and answers with the batch recomputed", async () => {
    const before = await viewOf(batchId);
    expect(before.counts.undecided).toBe(3);

    const response = await decideOn(batchId, "approved", [target("a")]);
    expect(response.status).toBe(200);
    const after = (await response.json()) as any;
    expect(after.counts.undecided).toBe(2);
    expect(after.rows.find(({ story }: any) => story === "a").decision).toMatchObject({ decision: "approved", actor: "tester@example.com" });
    expect(after.rows.find(({ story }: any) => story === "b").decision).toBeNull();
    expect(after.blockers.find(({ story }: any) => story === "a")).toBeUndefined();
    expect(await viewOf(batchId)).toEqual(after);
  });

  test("reject blocks, and a later approval replaces it", async () => {
    const rejected = (await (await decideOn(batchId, "rejected", [target("a")])).json()) as any;
    expect(rejected.blockers.find(({ story }: any) => story === "a")).toMatchObject({ reason: "rejected", detail: "tester@example.com" });
    const approved = (await (await decideOn(batchId, "approved", [target("a")])).json()) as any;
    expect(approved.blockers.find(({ story }: any) => story === "a")).toBeUndefined();
  });

  test("decides on many at once, or refuses them all if one isn't what the batch holds", async () => {
    const stale = await decideOn(batchId, "approved", [target("a"), { story: "b", imageHash: UNKNOWN_HASH }]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "stale-decision" } });
    expect((await viewOf(batchId)).counts.undecided).toBe(3);

    const all = (await (await decideOn(batchId, "approved", [target("a"), target("b"), target("d")])).json()) as any;
    expect(all.counts.undecided).toBe(0);
  });

  test("refuses what has no image to decide on, and what the batch doesn't have", async () => {
    const failed = await decideOn(batchId, "approved", [{ story: "c", imageHash: rows.find(({ story }) => story === "c").goldenHash }]);
    expect(failed.status).toBe(409);
    expect((await decideOn(batchId, "approved", [{ story: "nobody", imageHash: target("a").imageHash }])).status).toBe(409);
  });

  test("compares at most twice, and never reads the unchanged rows", async () => {
    const compareFromHistory = project.batches.compareFromHistory.bind(project.batches);
    const options: unknown[] = [];
    project.batches.compareFromHistory = (id, reachable, compareOptions) => {
      options.push(compareOptions);
      return compareFromHistory(id, reachable, compareOptions);
    };
    expect((await decideOn(batchId, "approved", [target("a")])).status).toBe(200);
    expect(options).toEqual([{ includeUnchanged: false }, undefined]);
    options.length = 0;
    await viewOf(batchId);
    expect(options).toHaveLength(1);
  });

  test("takes a story ID as itself, never as a pattern", async () => {
    h.stories = [{ id: "a*", color: BLUE }, { id: "ab", color: BLUE }];
    const { batchId: starred } = (await review()).json;
    const { rows: starredRows } = await viewOf(starred);
    const star = starredRows.find(({ story }: any) => story === "a*");
    const after = (await (await decideOn(starred, "approved", [{ story: "a*", imageHash: star.imageHash }])).json()) as any;
    expect(after.rows.find(({ story }: any) => story === "a*").decision).toMatchObject({ decision: "approved" });
    expect(after.rows.find(({ story }: any) => story === "ab").decision).toBeNull();
  });

  test("refuses a malformed request", async () => {
    for (const body of [
      "not json",
      "[]",
      {},
      { decision: "maybe", renders: [target("a")] },
      { decision: "approved" },
      { decision: "approved", renders: [] },
      { decision: "approved", renders: "all" },
      { decision: "approved", renders: [{ story: "a" }] },
      { decision: "approved", renders: [{ story: "", imageHash: target("a").imageHash }] },
      { decision: "approved", renders: [{ story: "a", imageHash: "nope" }] },
      { decision: "approved", renders: [null] },
    ]) {
      const response = await change(`/api/batches/${batchId}/decisions`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "bad-request" } });
    }
    expect((await viewOf(batchId)).counts.undecided).toBe(3);
  });

  test("refuses with no actor, in words, and records nothing", async () => {
    git(h.repo, "config", "user.email", "");
    const response = await decideOn(batchId, "approved", [target("a")]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "no-actor", message: expect.stringContaining("user.email") } });
    expect((await viewOf(batchId)).actor).toBeNull();
    expect((await viewOf(batchId)).counts.undecided).toBe(3);
  });

  test("reads as unchanged at a later commit in the same store", async () => {
    await decideOn(batchId, "approved", [target("a")]);
    await commit(h.repo, "again");
    const later = await viewOf((await review()).json.batchId);
    expect(later.rows.find(({ story }: any) => story === "a")).toBeUndefined();
    expect(later.counts.unchanged).toBe(1);
  });
});

describe("what approving on the page leaves", () => {
  test("a batch recorded on a dirty tree says so, even once the tree is clean, and can be approved", async () => {
    h.stories = [{ id: "a" }];
    await writeFile(path.join(h.repo, "scratch.txt"), "dirty");
    const { batchId } = (await review()).json;
    await rm(path.join(h.repo, "scratch.txt"));
    const view = await viewOf(batchId);
    expect(view.batch.dirty).toBe(true);
    const after = (await (await decideOn(batchId, "approved", [{ story: "a", imageHash: view.rows[0].imageHash }])).json()) as any;
    expect(after.blockers).toEqual([]);
  });

  test("once approved, the next review reads it as unchanged", async () => {
    h.stories = [{ id: "a" }];
    const { batchId } = (await review()).json;
    const { rows } = await viewOf(batchId);
    await decideOn(batchId, "approved", [{ story: "a", imageHash: rows[0].imageHash }]);
    const later = (await review()).json;
    expect(later.counts).toMatchObject({ unchanged: 1, added: 0 });
  });

  test("a removal is decided on with no image, and blocks until approved", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    await approveAll();
    await commit(h.repo, "drop b");
    h.stories = [{ id: "a" }];
    const { batchId } = (await review()).json;
    const view = await viewOf(batchId);
    expect(view.rows).toMatchObject([{ story: "b", state: "removed", imageHash: null }]);
    expect(view.blockers).toEqual([{ story: "b", reason: "removed", detail: null }]);
    expect(view.outsideFilter).toBe(0);

    expect((await decideOn(batchId, "approved", [{ story: "b", imageHash: UNKNOWN_HASH }])).status).toBe(409);
    const after = (await (await decideOn(batchId, "approved", [{ story: "b", imageHash: null }])).json()) as any;
    expect(after.blockers).toEqual([]);
    expect(after.counts.undecided).toBe(0);
  });

  test("a filtered batch says how many it left out, and doesn't call them removed", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    await approveAll();
    await commit(h.repo, "next");
    const { batchId } = (await review("--story", "a")).json;
    const view = await viewOf(batchId);
    expect(view.outsideFilter).toBe(1);
    expect(view.rows).toEqual([]);
    expect(view.counts.removed).toBe(0);
    expect(view.blockers).toEqual([]);
  });

  test("on a branch, compares with what the branch approved, and says which batch that was", async () => {
    h.stories = [{ id: "a" }, { id: "b" }];
    git(h.repo, "switch", "--quiet", "-c", "feature");
    await commit(h.repo, "on a branch");
    const first = (await review()).json;
    await h.cli("approve", first.batchId, "--all");
    await commit(h.repo, "more on the branch");
    h.stories = [{ id: "a", color: BLUE }, { id: "b" }];
    const { batchId } = (await review()).json;
    const view = await viewOf(batchId);
    expect(view.rows.map(({ story, state, goldenBatchId }: any) => [story, state, goldenBatchId])).toEqual([["a", "changed", first.batchId]]);
    expect(view.counts).toMatchObject({ unchanged: 1, changed: 1 });
    expect(view.blockers).toEqual([{ story: "a", reason: "changed-unapproved", detail: null }]);
    const unchanged = (await (await get(`/api/batches/${batchId}/unchanged`)).json()) as any;
    expect(unchanged.rows.map(({ story }: any) => story)).toEqual(["b"]);

    const after = (await (await change(`/api/batches/${batchId}/decisions`, { decision: "approved", renders: view.rows.map(({ story, imageHash }: any) => ({ story, imageHash })) })).json()) as any;
    expect(after.blockers).toEqual([]);
  });
});
