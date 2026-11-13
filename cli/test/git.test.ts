// What Git says of a repository, against real history, in repositories shaped for each case.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ancestorsOf, defaultBranchOf, dirtyPaths, headSha, openRepo } from "../src/git.ts";
import { commit, createRepo, git } from "./support.ts";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "selfie-git-test-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("defaultBranchOf", () => {
  const defaultBranch = async (repo: string, sha: string) => defaultBranchOf(await openRepo(repo), sha);

  test("on the default branch, a commit is where it left", async () => {
    const repo = await createRepo(scratch);
    const head = await commit(repo, "b");
    expect(await defaultBranch(repo, head)).toEqual({ defaultBranch: "main", mergeBase: head });
  });

  test("on a branch, says where it left, however far the default branch has moved on", async () => {
    const repo = await createRepo(scratch);
    const left = await commit(repo, "b");
    git(repo, "switch", "--quiet", "-c", "feature");
    const onFeature = await commit(repo, "on feature");
    git(repo, "switch", "--quiet", "main");
    await commit(repo, "main moved on");
    git(repo, "switch", "--quiet", "feature");
    expect(await defaultBranch(repo, onFeature)).toEqual({ defaultBranch: "main", mergeBase: left });
  });

  test("with no origin, uses a local default branch", async () => {
    const repo = await createRepo(scratch);
    expect((await openRepo(repo)).origin).toBeNull();
    const a = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "--quiet", "-c", "feature");
    const b = await commit(repo, "b");
    expect(await defaultBranch(repo, b)).toEqual({ defaultBranch: "main", mergeBase: a });
  });

  test("with no default branch at all, can say neither", async () => {
    const repo = await createRepo(scratch);
    git(repo, "branch", "--quiet", "-m", "trunk");
    const b = await commit(repo, "b");
    expect(await defaultBranch(repo, b)).toEqual({ defaultBranch: null, mergeBase: null });
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
    const b = await commit(clone, "b", "b.txt");
    expect(await defaultBranch(clone, b)).toEqual({ defaultBranch: "develop", mergeBase: a });
  });

  test("works from a detached HEAD", async () => {
    const repo = await createRepo(scratch);
    const a = git(repo, "rev-parse", "HEAD");
    await commit(repo, "b");
    git(repo, "switch", "--quiet", "--detach", a);
    const detached = await commit(repo, "c", "c.txt");
    expect(await headSha(await openRepo(repo))).toBe(detached);
    expect(await defaultBranch(repo, detached)).toEqual({ defaultBranch: "main", mergeBase: a });
  });

  test("a branch with no history in common left nowhere", async () => {
    const repo = await createRepo(scratch);
    git(repo, "switch", "--quiet", "--orphan", "other");
    const elsewhere = await commit(repo, "elsewhere", "elsewhere.txt");
    expect(await defaultBranch(repo, elsewhere)).toEqual({ defaultBranch: "main", mergeBase: null });
  });
});

describe("ancestorsOf", () => {
  test("is a commit and all it reaches, itself first, through every parent", async () => {
    const repo = await createRepo(scratch);
    const a = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "--quiet", "-c", "side");
    const side = await commit(repo, "side", "side.txt");
    git(repo, "switch", "--quiet", "main");
    const main = await commit(repo, "main", "main.txt");
    git(repo, "merge", "--quiet", "--no-edit", "side");
    const merged = git(repo, "rev-parse", "HEAD");
    const ancestors = await ancestorsOf(await openRepo(repo), merged);
    expect(ancestors[0]).toBe(merged);
    expect([...ancestors].sort()).toEqual([a, side, main, merged].sort());
    expect(await ancestorsOf(await openRepo(repo), side)).toEqual([side, a]);
  });

  test("is the commit alone if this clone doesn't have it, and all a shallow clone does have", async () => {
    const upstream = await createRepo(scratch, "upstream");
    const b = await commit(upstream, "b");
    const clone = path.join(scratch, "clone");
    git(scratch, "clone", "--quiet", "--depth=1", `file://${upstream}`, clone);
    const opened = await openRepo(clone);
    expect(await ancestorsOf(opened, b)).toEqual([b]);
    const unknown = "9".repeat(40);
    expect(await ancestorsOf(opened, unknown)).toEqual([unknown]);
  });
});

test("a repository with no commits has no HEAD", async () => {
  const repo = path.join(scratch, "empty");
  git(scratch, "init", "--quiet", "--initial-branch=main", repo);
  expect(await headSha(await openRepo(repo))).toBeNull();
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
