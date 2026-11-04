// The walk to a remote's goldens, against real Git history, in repositories shaped for each case.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dirtyPaths, headSha, openRepo, walkToBaseline } from "../src/git.ts";
import { commit, createRepo, git } from "./support.ts";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "selfie-git-test-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const find = async (cwd: string, goldens: readonly string[], maxCommits?: number) => {
  const asked: string[] = [];
  const result = await walkToBaseline(
    await openRepo(cwd),
    async (shas) => {
      asked.push(...shas);
      return shas.find((sha) => goldens.includes(sha)) ?? null;
    },
    maxCommits,
  );
  return { ...result, asked };
};

test("on the default branch, the nearest commit with goldens, starting at HEAD", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  const b = await commit(repo, "b");
  const c = await commit(repo, "c");

  expect((await find(repo, [c, a])).sha).toBe(c);
  const found = await find(repo, [a]);
  expect(found.sha).toBe(a);
  expect(found.asked).toEqual([c, b, a]);
  expect(found).toMatchObject({ defaultBranch: "main", mergeBase: c, reason: null });
});

test("on a branch, starts at the merge-base and ignores the branch's own goldens", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  const b = await commit(repo, "b");
  git(repo, "switch", "--quiet", "-c", "feature");
  const onFeature = await commit(repo, "on feature");
  git(repo, "switch", "--quiet", "main");
  await commit(repo, "main moved on");
  git(repo, "switch", "--quiet", "feature");

  const found = await find(repo, [onFeature, a]);
  expect(found.mergeBase).toBe(b);
  expect(found.sha).toBe(a);
});

test("walks first-parent history, so a merged branch's commits don't count", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "--quiet", "-c", "side");
  const side = await commit(repo, "side", "side.txt");
  git(repo, "switch", "--quiet", "main");
  await commit(repo, "main", "main.txt");
  git(repo, "merge", "--quiet", "--no-edit", "side");

  const found = await find(repo, [side, a]);
  expect(found.sha).toBe(a);
  expect(found.asked).not.toContain(side);
});

test("gives up after the bound, and says so", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  await commit(repo, "b");
  const c = await commit(repo, "c");

  const found = await find(repo, [a], 2);
  expect(found).toMatchObject({ sha: null, reason: "limit-reached" });
  expect(found.asked).toHaveLength(2);
  expect(found.asked[0]).toBe(c);
  expect(found.message).toContain("stops at 2");
});

test("says none were found when none have goldens", async () => {
  const repo = await createRepo(scratch);
  const found = await find(repo, []);
  expect(found).toMatchObject({ sha: null, reason: "no-goldens" });
});

test("with no origin, uses a local default branch", async () => {
  const repo = await createRepo(scratch);
  expect((await openRepo(repo)).origin).toBeNull();
  const a = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "--quiet", "-c", "feature");
  await commit(repo, "b");
  const found = await find(repo, [a]);
  expect(found).toMatchObject({ sha: a, defaultBranch: "main", mergeBase: a });
});

test("with no default branch at all, walks from HEAD and says so", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "--quiet", "-m", "trunk");
  const b = await commit(repo, "b");
  const found = await find(repo, [a]);
  expect(found).toMatchObject({ sha: a, defaultBranch: null, mergeBase: b });
  expect(found.message).toContain("No default branch");
  const none = await find(repo, []);
  expect(none.reason).toBe("no-goldens");
  expect(none.message).toContain("No default branch");
});

test("prefers origin/HEAD, which a clone records, even with a differently named branch", async () => {
  const upstream = await createRepo(scratch, "upstream");
  git(upstream, "branch", "--quiet", "-m", "develop");
  const a = await commit(upstream, "a");
  const clone = path.join(scratch, "clone");
  git(scratch, "clone", "--quiet", upstream, clone);
  git(clone, "config", "user.email", "tester@example.com");
  git(clone, "config", "user.name", "Tester");
  // A local `main` that isn't the default branch must not win.
  git(clone, "switch", "--quiet", "-c", "main");
  await commit(clone, "b", "b.txt");

  const found = await find(clone, [a]);
  expect(found).toMatchObject({ sha: a, defaultBranch: "origin/develop", mergeBase: a });
});

test("works from a detached HEAD", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  const b = await commit(repo, "b");
  git(repo, "switch", "--quiet", "--detach", b);
  const found = await find(repo, [a]);
  expect(found.sha).toBe(a);
  expect(await headSha(await openRepo(repo))).toBe(b);
});

test("in a shallow clone, finds what it can and otherwise says history is cut off", async () => {
  const upstream = await createRepo(scratch, "upstream");
  const a = git(upstream, "rev-parse", "HEAD");
  const b = await commit(upstream, "b");
  const clone = path.join(scratch, "clone");
  git(scratch, "clone", "--quiet", "--depth=1", `file://${upstream}`, clone);

  const found = await find(clone, [b]);
  expect(found).toMatchObject({ sha: b, reason: null });

  const cutOff = await find(clone, [a]);
  expect(cutOff).toMatchObject({ sha: null, reason: "shallow-history" });
  expect(cutOff.message).toContain("git fetch --unshallow");
  expect(cutOff.asked).toEqual([b]);
});

test("a branch with no history in common has no baseline", async () => {
  const repo = await createRepo(scratch);
  const a = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "--quiet", "--orphan", "other");
  await commit(repo, "elsewhere", "elsewhere.txt");
  const found = await find(repo, [a]);
  expect(found).toMatchObject({ sha: null, reason: "no-merge-base", mergeBase: null, defaultBranch: "main" });
});

test("a repository with no commits says so", async () => {
  const repo = path.join(scratch, "empty");
  await createRepo(scratch, "seed");
  git(scratch, "init", "--quiet", "--initial-branch=main", repo);
  const found = await find(repo, []);
  expect(found).toMatchObject({ sha: null, reason: "no-commits" });
});

describe("dirtyPaths", () => {
  test("sees edits, staged files, and untracked files, from any subdirectory's view", async () => {
    const repo = await createRepo(scratch);
    const opened = await openRepo(repo);
    expect(await dirtyPaths(opened)).toEqual([]);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(repo, "file.txt"), "edited\n");
    await writeFile(path.join(repo, "new.txt"), "new\n");
    expect(await dirtyPaths(opened)).toEqual(["file.txt", "new.txt"]);
  });

  test("ignores gitignored files, so a built Storybook there doesn't dirty the tree", async () => {
    const repo = await createRepo(scratch);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await writeFile(path.join(repo, ".gitignore"), "storybook-static/\n");
    git(repo, "add", ".gitignore");
    git(repo, "commit", "--quiet", "-m", "ignore");
    await mkdir(path.join(repo, "storybook-static"));
    await writeFile(path.join(repo, "storybook-static", "index.json"), "{}");
    expect(await dirtyPaths(await openRepo(repo))).toEqual([]);
  });
});
