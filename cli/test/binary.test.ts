// The real binary as a separate process: what an agent sees on stdout, and its exit code.
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRepo, git } from "./support.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

let scratch: string;
let repo: string;
let home: string;

const selfie = (cwd: string, ...args: string[]) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [MAIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SELFIE_HOME: home },
    // A command that keeps serving would otherwise hold this whole file, past any test's timeout.
    timeout: 20_000,
  });
  return { status, stdout, stderr };
};

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "selfie-binary-test-"));
  repo = await createRepo(scratch);
  home = path.join(scratch, "home");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("exit 2, with one JSON document saying why", () => {
  test.each([
    ["an unknown command", ["frobnicate"]],
    ["an unknown flag", ["review", "--nope"]],
    ["a stray argument", ["review", "extra"]],
    ["a bad --removed", ["accept", "7f0e6a2e-1234-4abc-8def-0123456789ab", "--removed", "many"]],
    ["no batch", ["accept"]],
    ["no selection", ["approve", "7f0e6a2e-1234-4abc-8def-0123456789ab"]],
    ["a missing Storybook", ["review", "--storybook-dir", "does-not-exist"]],
    ["a removed flag", ["review", "--human"]],
    ["another removed flag", ["find-baseline", "--max-commits", "1"]],
  ])("%s", (_, args) => {
    const { status, stdout, stderr } = selfie(repo, ...args);
    expect(status).toBe(2);
    const { error } = JSON.parse(stdout);
    expect(error.message).toBeTruthy();
    expect(error.code).toBeTruthy();
    expect(stderr).toContain("selfie:");
  });

  test("outside a Git repository", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "selfie-not-a-repo-"));
    try {
      for (const args of [["review"], ["find-baseline"], ["approve", "x", "--all"]]) {
        const { status, stdout } = selfie(outside, ...args);
        expect(status).toBe(2);
        expect(JSON.parse(stdout).error.message).toBeTruthy();
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("a build command's output goes to stderr, keeping stdout one document", () => {
  const { status, stdout, stderr } = selfie(
    repo,
    "review",
    "--build-command",
    "echo pollution-on-stdout; echo pollution-on-stderr >&2",
    "--storybook-dir",
    "does-not-exist",
  );
  expect(status).toBe(2);
  expect(stdout).not.toContain("pollution");
  expect(JSON.parse(stdout).error.message).toContain("does-not-exist");
  expect(stderr).toContain("pollution-on-stdout");
  expect(stderr).toContain("pollution-on-stderr");
});

test("find-baseline prints null with a reason, and exits 0", () => {
  const { status, stdout } = selfie(repo, "find-baseline");
  expect(status).toBe(0);
  const result = JSON.parse(stdout);
  expect(result).toMatchObject({
    sha: null,
    reason: "no-goldens",
    mergeBase: git(repo, "rev-parse", "HEAD"),
    defaultBranch: "main",
  });
  expect(result.environment).toMatch(/^container-linux-arm64-[0-9a-f]{16}$/);
});

test("--native names this machine's environment, which shares no goldens with the container's", () => {
  const { status, stdout } = selfie(repo, "find-baseline", "--native");
  expect(status).toBe(0);
  expect(JSON.parse(stdout).environment).toMatch(/^native-/);
});

test("--help prints usage and exits 0", () => {
  const { status, stdout } = selfie(repo, "--help");
  expect(status).toBe(0);
  expect(stdout).toContain("selfie <command>");
});

test("data lands under SELFIE_HOME only", async () => {
  selfie(repo, "find-baseline");
  const entries = await readdir(home);
  expect(entries).toHaveLength(1);
  expect(await readdir(path.join(home, entries[0]!))).toContain("store.db");
});
