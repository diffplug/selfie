// What a person sees as they work: approvals made anywhere in a commit's history count there, with
// real Git, a real store, and only the browser replaced. See docs/specs/renders.md -> Approvals.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BLUE, commit, createHarness, git, GREEN, TEST_CONFIG, type Harness } from "./support.ts";

let h: Harness;
let build: string;
let builds = 0;

/** Renders what `h.stories` says as a new built Storybook, and reviews it. */
async function review(...flags: string[]) {
  builds += 1;
  await writeFile(path.join(build, "iframe.html"), `<html>${builds}</html>`);
  const { json } = await h.cli("render", ...flags);
  const reviewed = await h.cli("review", json.batchId);
  const states = Object.fromEntries(reviewed.json.differences.map(({ story, state }: any) => [story, state]));
  return { batchId: json.batchId as string, code: reviewed.code, json: reviewed.json, states };
}

beforeEach(async () => {
  h = await createHarness();
  build = path.join(h.repo, TEST_CONFIG.storybookDir);
  await mkdir(build, { recursive: true });
  h.stories = [{ id: "a--one" }, { id: "a--two" }];
});
afterEach(async () => {
  await h.destroy();
});

describe("on a feature branch, with nothing ever done on the default branch", () => {
  beforeEach(async () => {
    git(h.repo, "checkout", "-b", "feature");
  });

  test("everything is added, and needs an approval", async () => {
    const { code, states } = await review();
    expect(code).toBe(1);
    expect(states).toEqual({ "a--one": "added", "a--two": "added" });
  });

  test("an approved story stays in its own batch's review, approved, and nothing blocks", async () => {
    const { batchId } = await review();
    expect((await h.cli("approve", batchId, "--all")).code).toBe(0);
    const again = await h.cli("review", batchId);
    expect(again.code).toBe(0);
    expect(again.json.differences.map(({ state, decision }: any) => [state, decision?.decision])).toEqual([
      ["added", "approved"],
      ["added", "approved"],
    ]);
    expect(again.json.counts).toMatchObject({ undecided: 0, added: 2 });
  });

  test("the next commit shows what changed since the approvals, and approving part of it never asks for that part again", async () => {
    const first = await review();
    await h.cli("approve", first.batchId, "--all");

    await commit(h.repo, "changes both");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two", color: BLUE }];
    const second = await review();
    expect(second.states).toEqual({ "a--one": "changed", "a--two": "changed" });
    await h.cli("approve", second.batchId, "--story", "a--one");

    await commit(h.repo, "changes neither");
    const third = await review();
    expect(third.states).toEqual({ "a--two": "changed" });
    expect(third.json.counts).toMatchObject({ unchanged: 1, changed: 1, undecided: 1 });
  });

  test("a batch at the same commit sees what was approved on another", async () => {
    const first = await review();
    await h.cli("approve", first.batchId, "--all");
    const second = await review();
    expect(second.code).toBe(0);
    expect(second.states).toEqual({});
  });

  test("a rebase leaves its approvals out of Git's history, and they still count, even onto something newer", async () => {
    await commit(h.repo, "on the feature");
    const first = await review();
    await h.cli("approve", first.batchId, "--all");
    const before = git(h.repo, "rev-parse", "HEAD").trim();

    git(h.repo, "checkout", "-");
    const defaultBranch = git(h.repo, "branch", "--show-current").trim();
    await commit(h.repo, "the default branch moves", "other.txt");
    git(h.repo, "checkout", "feature");
    git(h.repo, "rebase", defaultBranch);
    expect(() => git(h.repo, "merge-base", "--is-ancestor", before, "HEAD")).toThrow();

    const rebased = await review();
    expect(rebased.states).toEqual({});
  });

  test("an old branch of the same name doesn't count, since its work ended before this one's began", async () => {
    await commit(h.repo, "the old work");
    const first = await review();
    await h.cli("approve", first.batchId, "--all");
    git(h.repo, "checkout", "-");
    git(h.repo, "branch", "-D", "feature");
    git(h.repo, "checkout", "-b", "feature");
    // Git keeps author times to the second, and this test is quicker than that.
    await writeFile(path.join(h.repo, "new.txt"), "new work");
    git(h.repo, "add", "new.txt");
    git(h.repo, "commit", "--quiet", "-m", "the same name, new work", "--date", new Date(Date.now() + 2000).toISOString());
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    const second = await review();
    expect(second.states).toMatchObject({ "a--one": "added" });
  });
});

describe("across branches", () => {
  async function approvedOn(branch: string) {
    git(h.repo, "checkout", "-b", branch);
    await commit(h.repo, `on ${branch}`);
    const batch = await review();
    await h.cli("approve", batch.batchId, "--all");
  }

  test("a merge carries a branch's approvals, so the default branch needn't approve again", async () => {
    await approvedOn("feature");
    git(h.repo, "checkout", "-");
    git(h.repo, "merge", "--no-ff", "--no-edit", "feature");
    const { code, states } = await review();
    expect(code).toBe(0);
    expect(states).toEqual({});
  });

  test("a branch's approvals count nowhere its history doesn't go", async () => {
    await approvedOn("feature");
    git(h.repo, "checkout", "-");
    git(h.repo, "checkout", "-b", "other");
    const { states } = await review();
    expect(states).toEqual({ "a--one": "added", "a--two": "added" });
  });
});

describe("what an approval means", () => {
  test("an image approved once and since replaced asks again if it comes back", async () => {
    const green = await review();
    await h.cli("approve", green.batchId, "--all");
    await commit(h.repo, "goes blue");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    const blue = await review();
    await h.cli("approve", blue.batchId, "--all");

    await commit(h.repo, "goes back");
    h.stories = [{ id: "a--one", color: GREEN }, { id: "a--two" }];
    const back = await review();
    expect(back.states).toEqual({ "a--one": "changed" });
    expect(back.json.differences[0].decision).toBeNull();
  });

  test("a removal is approved like anything else, and a story that comes back is added", async () => {
    const both = await review();
    await h.cli("approve", both.batchId, "--all");

    await commit(h.repo, "drops one");
    h.stories = [{ id: "a--one" }];
    const dropped = await review();
    expect(dropped.code).toBe(1);
    expect(dropped.states).toEqual({ "a--two": "removed" });
    expect(dropped.json.blockers).toEqual([{ story: "a--two", reason: "removed", detail: null }]);
    await h.cli("approve", dropped.batchId, "--all");
    expect((await h.cli("review", dropped.batchId)).code).toBe(0);

    await commit(h.repo, "still gone");
    const gone = await review();
    expect(gone.code).toBe(0);
    expect(gone.states).toEqual({});

    await commit(h.repo, "brings it back");
    h.stories = [{ id: "a--one" }, { id: "a--two" }];
    const back = await review();
    expect(back.states).toEqual({ "a--two": "added" });
  });

  test("a story a filter left out isn't called gone, and can't be approved as gone", async () => {
    const both = await review();
    await h.cli("approve", both.batchId, "--all");
    await commit(h.repo, "moves on");
    const part = await review("--story", "a--one");
    expect(part.code).toBe(0);
    expect(part.states).toEqual({});
    await h.cli("approve", part.batchId, "--all");

    await commit(h.repo, "moves on again");
    const whole = await review();
    expect(whole.code).toBe(0);
    expect(whole.states).toEqual({});
  });

  test("a rejection leaves what's approved alone, and blocks", async () => {
    const first = await review();
    await h.cli("approve", first.batchId, "--all");
    await commit(h.repo, "changes one");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    const second = await review();
    await h.cli("reject", second.batchId, "--all");
    const reviewed = await h.cli("review", second.batchId);
    expect(reviewed.code).toBe(1);
    expect(reviewed.json.blockers).toMatchObject([{ story: "a--one", reason: "rejected" }]);

    await commit(h.repo, "still that");
    const third = await review();
    expect(third.states).toEqual({ "a--one": "changed" });
    expect(third.json.differences[0].goldenHash).toBe(second.json.differences[0].goldenHash);
  });

  test("--baseline <commit> compares with what that commit's history approved, for this review alone", async () => {
    const first = await review();
    await h.cli("approve", first.batchId, "--all");
    const start = (git(h.repo, "rev-parse", "HEAD")).trim();
    await commit(h.repo, "changes one");
    h.stories = [{ id: "a--one", color: BLUE }, { id: "a--two" }];
    const second = await review();
    await h.cli("approve", second.batchId, "--all");
    await commit(h.repo, "stays");
    const third = await review();
    expect(third.states).toEqual({});

    const against = await h.cli("review", third.batchId, "--baseline", start);
    expect(against.json.comparedWith).toEqual({ source: "given", sha: start, batch: null });
    expect(against.json.differences.map(({ story }: any) => story)).toEqual(["a--one"]);
    expect(against.code).toBe(1);
  });
});
