// Everything Selfie asks Git. Always argument arrays through `execFile`, never a shell.
import { isGitSha } from "selfie-store";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { SelfieError } from "./errors.ts";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** How far back history is read, for approvals, and for a remote's goldens. */
const MAX_COMMITS = 1000;

// origin/HEAD is what a clone records. The rest are the usual names, for a repository whose
// remote was added by hand, or which has no remote at all.
const ORIGIN_HEAD = "refs/remotes/origin/HEAD";
const DEFAULT_BRANCH_CANDIDATES = [
  "refs/remotes/origin/main",
  "refs/remotes/origin/master",
  "refs/heads/main",
  "refs/heads/master",
];

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ code: 0, stdout, stderr });
      } else if (typeof error.code === "number") {
        resolve({ code: error.code, stdout, stderr });
      } else {
        reject(new SelfieError("git-failed", `Can't run git: ${error.message}`));
      }
    });
  });
}

/** Git's answer, trimmed, or null if it answered with a failure. */
async function ask(cwd: string, args: readonly string[]): Promise<string | null> {
  const { code, stdout } = await git(cwd, args);
  return code === 0 ? stdout.trim() : null;
}

export interface Repo {
  /** The working tree's top level. */
  readonly root: string;
  /** Shared by all of a repository's worktrees, so they share one store if there's no origin. */
  readonly commonDir: string;
  /** May hold credentials, so it goes no further than `projectSlug`. */
  readonly origin: string | null;
}

export async function openRepo(cwd: string): Promise<Repo> {
  const [root, commonDir] = (await ask(cwd, ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"]))?.split("\n") ?? [];
  if (!root || !commonDir) {
    throw new SelfieError(
      "not-a-repository",
      `${cwd} isn't inside a Git working tree, and Selfie records every batch against a Git SHA.`,
    );
  }
  return {
    root,
    commonDir: await realpath(commonDir),
    origin: await ask(root, ["remote", "get-url", "origin"]),
  };
}

/** HEAD's full SHA, or null if the repository has no commits yet. */
export async function headSha(repo: Repo): Promise<string | null> {
  const sha = await ask(repo.root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  return sha !== null && isGitSha(sha) ? sha : null;
}

/** The branch HEAD is on, even with no commits yet, or null if it's detached. */
export const currentBranch = (repo: Repo): Promise<string | null> => ask(repo.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

/** When HEAD last moved here, by commit, checkout, or reset, in milliseconds. The commit's own time, if the reflog has none. */
export async function headMovedAt(repo: Repo): Promise<number | null> {
  const moved = /@\{(\d+)\}/.exec((await ask(repo.root, ["reflog", "-1", "--date=unix", "--format=%gd", "HEAD"])) ?? "")?.[1];
  const seconds = moved ?? (await ask(repo.root, ["show", "-s", "--format=%ct", "HEAD"]));
  return seconds === undefined || seconds === null ? null : Number(seconds) * 1000;
}

/** Modified, staged, and untracked paths across the whole working tree. Ignored files don't count. */
export async function dirtyPaths(repo: Repo): Promise<string[]> {
  const { code, stdout, stderr } = await git(repo.root, ["--no-optional-locks", "status", "--porcelain"]);
  if (code !== 0) throw new SelfieError("git-failed", `git status failed: ${stderr.trim()}`);
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
}

/** Who `git config` says this is. */
export async function gitUserEmail(repo: Repo): Promise<string | null> {
  return (await ask(repo.root, ["config", "user.email"])) || null;
}

/** The commit a name means here, or null. */
export async function resolveCommit(repo: Repo, ref: string): Promise<string | null> {
  if (ref.startsWith("-")) return null;
  return ask(repo.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
}

export type NoBaselineReason =
  | "no-commits"
  | "no-merge-base"
  | "shallow-history"
  | "limit-reached"
  | "no-goldens";

/** The one shape of a baseline. A null `sha` means there is none, and `reason` and `message` say why. */
export interface Baseline {
  readonly sha: string | null;
  readonly reason: NoBaselineReason | null;
  readonly message: string | null;
}

export interface BaselineSearch extends Baseline {
  /** Null if no default branch was found, and then the walk starts at HEAD. */
  readonly defaultBranch: string | null;
  readonly mergeBase: string | null;
}

/** One process however many names it tries, since every command that finds a baseline asks this. */
async function defaultBranchRef(repo: Repo): Promise<string | null> {
  const listed = await ask(repo.root, ["for-each-ref", "--format=%(objecttype) %(refname) %(symref)", ORIGIN_HEAD, ...DEFAULT_BRANCH_CANDIDATES]);
  const commits = new Map(
    (listed ?? "")
      .split("\n")
      .map((line) => line.split(" "))
      .filter(([type]) => type === "commit")
      .map(([, ref, target]) => [ref!, target ?? ""]),
  );
  const remoteHead = commits.get(ORIGIN_HEAD);
  return remoteHead || (DEFAULT_BRANCH_CANDIDATES.find((ref) => commits.has(ref)) ?? null);
}

async function firstParentHistory(repo: Repo, start: string, maxCommits: number): Promise<string[]> {
  const { code, stdout, stderr } = await git(repo.root, [
    "rev-list",
    "--first-parent",
    `--max-count=${maxCommits}`,
    start,
  ]);
  if (code !== 0) throw new SelfieError("git-failed", `git rev-list failed: ${stderr.trim()}`);
  return stdout.split("\n").filter((line) => line !== "");
}

/**
 * The nearest commit at or before the merge-base with the default branch, on first-parent
 * history, for which `firstWithGoldens` answers. It is given those commits, nearest first.
 */
export async function walkToBaseline(
  repo: Repo,
  firstWithGoldens: (shas: readonly string[]) => Promise<string | null>,
  maxCommits: number = MAX_COMMITS,
): Promise<BaselineSearch> {
  const head = await headSha(repo);
  const isShallow = async () => (await ask(repo.root, ["rev-parse", "--is-shallow-repository"])) === "true";
  if (head === null) {
    return {
      sha: null,
      reason: "no-commits",
      message: "This repository has no commits yet.",
      defaultBranch: null,
      mergeBase: null,
    };
  }

  const ref = await defaultBranchRef(repo);
  const defaultBranch = ref?.replace(/^refs\/(?:remotes|heads)\//, "") ?? null;
  const mergeBase = ref === null ? head : await ask(repo.root, ["merge-base", "HEAD", ref]);
  if (mergeBase === null) {
    const found = { sha: null, defaultBranch, mergeBase: null };
    return (await isShallow())
      ? {
          ...found,
          reason: "shallow-history",
          message: `This clone is shallow and its history stops before HEAD meets ${defaultBranch}. Fetch more with \`git fetch --unshallow\`.`,
        }
      : { ...found, reason: "no-merge-base", message: `HEAD shares no history with ${defaultBranch}.` };
  }

  const commits = await firstParentHistory(repo, mergeBase, maxCommits);
  const noDefaultBranch =
    ref === null ? "No default branch was found (origin/HEAD, main, or master), so this walked from HEAD." : null;
  const sha = await firstWithGoldens(commits);
  if (sha !== null) return { sha, reason: null, message: noDefaultBranch, defaultBranch, mergeBase };

  const none = { sha: null, defaultBranch, mergeBase };
  const looked = `None of the ${commits.length} first-parent commits from ${mergeBase.slice(0, 12)} has goldens`;
  if (commits.length === maxCommits) {
    return { ...none, reason: "limit-reached", message: `${looked}, and the search stops at ${maxCommits}.` };
  }
  if (await isShallow()) {
    return {
      ...none,
      reason: "shallow-history",
      message: `${looked}, but this clone is shallow, so older commits may. Fetch more with \`git fetch --unshallow\`.`,
    };
  }
  return {
    ...none,
    reason: "no-goldens",
    message: `${looked} in this environment.${noDefaultBranch === null ? "" : ` ${noDefaultBranch}`}`,
  };
}

/** Every commit this one's history reaches, itself first, through every parent. Itself alone if this clone doesn't have it. */
export async function ancestorsOf(repo: Repo, sha: string): Promise<readonly string[]> {
  const listed = await ask(repo.root, ["rev-list", `--max-count=${MAX_COMMITS}`, sha]);
  return listed === null ? [sha] : listed.split("\n");
}

/** Whether this clone's history stops early, so that older approvals can't be reached. */
export const isShallow = async (repo: Repo): Promise<boolean> => (await ask(repo.root, ["rev-parse", "--is-shallow-repository"])) === "true";

/** The default branch, by name, and where a commit left it. Each is null if Git can't say. */
export async function defaultBranchOf(repo: Repo, sha: string): Promise<{ readonly defaultBranch: string | null; readonly mergeBase: string | null }> {
  const ref = await defaultBranchRef(repo);
  return {
    defaultBranch: ref?.replace(/^refs\/(?:remotes|heads)\//, "") ?? null,
    mergeBase: ref === null ? null : await ask(repo.root, ["merge-base", sha, ref]),
  };
}

/**
 * When a branch's work began: the earliest author time of the commits it has that this base doesn't,
 * in milliseconds. A rebase keeps author times, so this holds still however often the base moves.
 * Null if there are no such commits.
 */
export async function earliestAuthoredSince(repo: Repo, base: string | null, sha: string): Promise<number | null> {
  const listed = await ask(repo.root, ["log", "--format=%at", base === null ? sha : `${base}..${sha}`]);
  if (listed === null || listed === "") return null;
  return Math.min(...listed.split("\n").map(Number)) * 1000;
}
