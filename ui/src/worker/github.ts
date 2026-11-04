// The GitHub App, as far as a commit's status needs it: which commits a repository has, and saying
// what a commit's snapshots read as. See docs/specs/access.md -> GitHub App.
import type { CommitStatus } from "../shared/commit-status.ts";

export interface Repository {
  readonly owner: string;
  readonly name: string;
}

/** What the Worker needs from GitHub, which a test stands in for. */
export interface GitHub {
  hasCommit(repository: Repository, sha: string): Promise<boolean>;
  postStatus(repository: Repository, sha: string, status: CommitStatus, targetUrl: string): Promise<void>;
}

const API = "https://api.github.com";
/** One context per commit, so a new status replaces the last. */
const STATUS_CONTEXT = "selfie";
// They last an hour, so there's room for a request that started just before this ran out.
const TOKEN_KEPT_MS = 50 * 60 * 1000;

const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const utf8 = (text: string) => new TextEncoder().encode(text);

async function appJwt(appId: string, privateKeyPem: string): Promise<string> {
  const der = Uint8Array.from(atob(privateKeyPem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  // A little in the past, since GitHub's clock may be behind this one.
  const body = `${base64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${base64url(utf8(JSON.stringify({ iat: now - 30, exp: now + 300, iss: appId })))}`;
  return `${body}.${base64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(body)))}`;
}

// Across requests, so a page's status needn't sign anything twice in the hour.
const tokens = new Map<string, { readonly token: string; readonly until: number }>();

export function githubApp({ appId, privateKey }: { readonly appId: string; readonly privateKey: string }): GitHub {
  const ask = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "selfie-hackathon", "x-github-api-version": "2022-11-28" },
    });

  const tokenFor = async ({ owner, name }: Repository): Promise<string> => {
    const key = `${owner}/${name}`;
    const held = tokens.get(key);
    if (held !== undefined && held.until > Date.now()) return held.token;
    const jwt = await appJwt(appId, privateKey);
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
  };
}
