// Everything Selfie asks Git. Always argument arrays through `execFile`, never a shell.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { SelfieError } from "./errors.ts";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The first-parent commits `find-baseline` looks at, from the merge-base. */
const MAX_COMMITS = 1000;

// origin/HEAD is what a clone records. The rest are the usual names, for a repository whose
// remote was added by hand, or which has no remote at all.
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
  const root = await ask(cwd, ["rev-parse", "--show-toplevel"]);
  const commonDir = await ask(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (root === null || commonDir === null || root === "") {
    throw new SelfieError(
      "not-a-repository",
      `${cwd} isn't inside a Git working tree, and Selfie records every run against a Git SHA.`,
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
  return sha !== null && FULL_SHA.test(sha) ? sha : null;
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

async function defaultBranchRef(repo: Repo): Promise<string | null> {
  const remoteHead = await ask(repo.root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const candidates = remoteHead === null ? DEFAULT_BRANCH_CANDIDATES : [remoteHead, ...DEFAULT_BRANCH_CANDIDATES];
  for (const ref of candidates) {
    if ((await ask(repo.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null) return ref;
  }
  return null;
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
  const shallow = (await ask(repo.root, ["rev-parse", "--is-shallow-repository"])) === "true";
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
    return shallow
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
  if (shallow) {
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

/** Whether a later review could find goldens at this SHA: it is on the default branch's first-parent history. */
export async function isOnBaselineHistory(repo: Repo, sha: string): Promise<boolean> {
  const history = await firstParentHistory(repo, (await defaultBranchRef(repo)) ?? "HEAD", MAX_COMMITS);
  return history.includes(sha);
}
