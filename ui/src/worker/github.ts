// The GitHub App, as far as the service needs it: which commits a repository has, saying what a commit's
// snapshots read as, and what code changed between two commits. See docs/specs/access.md -> GitHub App.
import { sign } from "hono/jwt";
import type { CommitStatus } from "../shared/commit-status.ts";

export interface Repository {
  readonly owner: string;
  readonly name: string;
}

export interface ChangedFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  /** Null for what has no text to show, such as a binary file, or one too large for GitHub to say. */
  readonly patch: string | null;
}

export interface CodeChange {
  /** Where the two sides met, which is `base` itself when `head` is built on it. */
  readonly base: string;
  readonly head: string;
  readonly totalCommits: number;
  readonly commits: readonly { readonly sha: string; readonly message: string }[];
  readonly files: readonly ChangedFile[];
}

/** What the Worker needs from GitHub, which a test stands in for. */
export interface GitHub {
  hasCommit(repository: Repository, sha: string): Promise<boolean>;
  postStatus(repository: Repository, sha: string, status: CommitStatus, targetUrl: string): Promise<void>;
  /** What changed from `base` to `head`, either of which may be any name Git has for a commit, or null if GitHub has no such pair. */
  compare(repository: Repository, base: string, head: string): Promise<CodeChange | null>;
}

const API = "https://api.github.com";
/** One context per commit, so a new status replaces the last. */
const STATUS_CONTEXT = "selfie";
// They last an hour, so there's room for a request that started just before this ran out.
const TOKEN_KEPT_MS = 50 * 60 * 1000;

interface GitHubComparison {
  readonly merge_base_commit: { readonly sha: string };
  readonly total_commits: number;
  readonly commits: readonly { readonly sha: string; readonly commit: { readonly message: string } }[];
  readonly files?: readonly { readonly filename: string; readonly status: string; readonly additions: number; readonly deletions: number; readonly patch?: string }[];
}

export function githubApp({ appId, privateKey }: { readonly appId: string; readonly privateKey: string }): GitHub {
  const ask = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "selfie-hackathon", "x-github-api-version": "2022-11-28" },
    });

  // So that a status needn't sign anything twice in the hour.
  const tokens = new Map<string, { readonly token: string; readonly until: number }>();
  const tokenFor = async ({ owner, name }: Repository): Promise<string> => {
    const key = `${owner}/${name}`;
    const held = tokens.get(key);
    if (held !== undefined && held.until > Date.now()) return held.token;
    const now = Math.floor(Date.now() / 1000);
    // A little in the past, since GitHub's clock may be behind this one.
    const jwt = await sign({ iat: now - 30, exp: now + 300, iss: appId }, privateKey, "RS256");
    const installation = await ask(`/repos/${owner}/${name}/installation`, jwt);
    if (!installation.ok) throw new Error(`The GitHub App isn't installed on ${key}: ${installation.status}`);
    const { id } = (await installation.json()) as { id: number };
    const created = await ask(`/app/installations/${id}/access_tokens`, jwt, { method: "POST" });
    if (!created.ok) throw new Error(`GitHub wouldn't give a token for ${key}: ${created.status}`);
    const { token } = (await created.json()) as { token: string };
    tokens.set(key, { token, until: Date.now() + TOKEN_KEPT_MS });
    return token;
  };

  return {
    async hasCommit(repository, sha) {
      const response = await ask(`/repos/${repository.owner}/${repository.name}/commits/${sha}`, await tokenFor(repository));
      if (response.ok) return true;
      // GitHub answers 422 for a full SHA it doesn't have, and 404 for a repository's missing commit.
      if (response.status === 404 || response.status === 422) return false;
      throw new Error(`GitHub couldn't say whether it has ${sha}: ${response.status}`);
    },
    async postStatus(repository, sha, { state, description }, targetUrl) {
      const response = await ask(`/repos/${repository.owner}/${repository.name}/statuses/${sha}`, await tokenFor(repository), {
        method: "POST",
        body: JSON.stringify({ state, description: description.slice(0, 140), context: STATUS_CONTEXT, target_url: targetUrl }),
      });
      if (!response.ok) throw new Error(`GitHub wouldn't take a status for ${sha}: ${response.status}`);
    },
    async compare(repository, base, head) {
      const response = await ask(`/repos/${repository.owner}/${repository.name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, await tokenFor(repository));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`GitHub couldn't compare ${base} with ${head}: ${response.status}`);
      const { merge_base_commit, total_commits, commits, files } = (await response.json()) as GitHubComparison;
      return {
        base: merge_base_commit.sha,
        head,
        totalCommits: total_commits,
        commits: commits.map(({ sha, commit }) => ({ sha, message: commit.message })),
        files: (files ?? []).map(({ filename, status, additions, deletions, patch }) => ({ path: filename, status, additions, deletions, patch: patch ?? null })),
      };
    },
  };
}
