// Moving a run, its images, its decisions, and its goldens between this store and another, through
// the routes in `selfie-ui/sync`. Every step is safe to send again, so a push or pull that dies is
// finished by running it again. See `docs/specs/sync.md`.
import { chunks, mapConcurrently, type RunPage } from "selfie-store";
import { SYNC_LIMITS, type GoldensAnswer, type ProjectAccess, type SentDecision, type SentRun, type SentSnapshot, type SyncError } from "selfie-ui/sync-api";
import { resolveCaptureSettings } from "./config.ts";
import { SelfieError } from "./errors.ts";
import { walkToBaseline, type BaselineSearch } from "./git.ts";
import { normalizeOrigin } from "./paths.ts";
import { findBaseline, runsAtHead, type Project } from "./project.ts";

/** How many images go at once, which is about a person's connection and not the store's. */
const IMAGES_AT_ONCE = 8;

export type Fetch = typeof fetch;

/** Another store, and who to say is asking. */
export interface Remote {
  readonly url: string;
  readonly token: string | null;
  readonly fetch: Fetch;
}

/** The server said no, with a reason of its own, which is the code a caller sees. */
class RemoteError extends Error {
  override readonly name = "RemoteError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The remote that's set, or null. Only from a flag or the environment, and never from a checkout's
 * config, which could otherwise send someone's token to any server.
 */
export function resolveRemote(flag: string | undefined, env: NodeJS.ProcessEnv, fetchWith: Fetch = fetch): Remote | null {
  const given = flag ?? env.SELFIE_REMOTE;
  if (given === undefined || given === "") return null;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new SelfieError("bad-remote", `"${given}" isn't the address of a server.`);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new SelfieError("bad-remote", `A remote must be https, since a token goes to it, and "${given}" isn't.`);
  }
  return { url: given.replace(/\/+$/, ""), token: env.SELFIE_TOKEN || null, fetch: fetchWith };
}

export function requireRemote(flag: string | undefined, env: NodeJS.ProcessEnv, fetchWith?: Fetch): Remote {
  const remote = resolveRemote(flag, env, fetchWith);
  if (remote === null) throw new SelfieError("no-remote", "Say which server with --remote or SELFIE_REMOTE.");
  return remote;
}

async function ask(remote: Remote, route: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (remote.token !== null) headers.set("authorization", `Bearer ${remote.token}`);
  let response: Response;
  try {
    response = await remote.fetch(`${remote.url}/api${route}`, { ...init, headers });
  } catch (error) {
    throw new RemoteError("remote-unreachable", `Can't reach ${remote.url}: ${(error as Error).message}`);
  }
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as SyncError | null;
  throw new RemoteError(body?.error.code ?? "remote-failed", body?.error.message ?? `${remote.url} answered ${response.status}.`);
}

const askJson = async <T>(remote: Remote, route: string, method = "GET", body?: unknown): Promise<T> => {
  const init = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await ask(remote, route, init);
  // A proxy or a captive portal can answer anything at all.
  return response.json().catch(() => {
    throw new RemoteError("remote-failed", `${remote.url} didn't answer as a Selfie server does.`);
  }) as Promise<T>;
};

/** The project of this repository's GitHub origin, which is its numeric ID there and not its name. */
async function projectRoute(project: Project, remote: Remote): Promise<string> {
  const origin = project.repo.origin === null ? null : /^github\.com\/([^/]+)\/([^/]+)$/.exec(normalizeOrigin(project.repo.origin));
  if (origin === null) throw new RemoteError("no-github-origin", "This repository's origin isn't on GitHub, which is how a remote finds its project.");
  const { project: id } = await askJson<{ project: string }>(remote, `/repositories/${origin[1]}/${origin[2]}`);
  return `/projects/${id}`;
}

async function allOfRun(read: (after: string) => Promise<RunPage>): Promise<Pick<RunPage, "run" | "snapshots">> {
  const first = await read("");
  const snapshots = [...first.snapshots];
  for (let next = first.next; next !== null; ) {
    const page = await read(next);
    snapshots.push(...page.snapshots);
    next = page.next;
  }
  return { run: first.run, snapshots };
}

const hashesIn = (snapshots: RunPage["snapshots"]) => [...new Set(snapshots.flatMap(({ imageHash }) => imageHash ?? []))];

/** The decisions on a run's images, wherever they're going. */
const decidedIn = (snapshots: RunPage["snapshots"]) => snapshots.flatMap(({ story, imageHash, decision }) => (imageHash === undefined || decision === null ? [] : [{ story, imageHash, ...decision }]));

const recordedIn = (snapshots: RunPage["snapshots"]): SentSnapshot[] => snapshots.map(({ decision: _, ...recorded }) => recorded);

/** The commit the remote would hold these commits to, nearest first. */
const remoteFirst = (remote: Remote, route: string, shas: readonly string[], environment: string) => askJson<{ sha: string | null }>(remote, `${route}/goldens/first`, "POST", { shas, environment });

const remoteBaseline = (project: Project, remote: Remote, route: string, environment: string) =>
  walkToBaseline(project.repo, async (shas) => (await remoteFirst(remote, route, shas, environment)).sha);

export interface PushResult {
  readonly runId: string;
  readonly images: { readonly sent: number; readonly alreadyThere: number };
  /** Decisions sent, or null if this token can't decide, so none could go. */
  readonly decisions: number | null;
  /** What became of its goldens, or null if none were asked for. */
  readonly goldens: GoldensAnswer | null;
}

/** What the remote lacks of a run it's holding, and the run's snapshots. Says how many images went. */
async function uploadRun(project: Project, remote: Remote, route: string, runId: string, finishedAt: number | null, held: RunPage["snapshots"]): Promise<number> {
  const missing: string[] = [];
  for (const group of chunks(hashesIn(held), SYNC_LIMITS.hashes)) {
    missing.push(...(await askJson<{ missing: readonly string[] }>(remote, `${route}/images/missing`, "POST", { hashes: group })).missing);
  }
  await mapConcurrently(missing, IMAGES_AT_ONCE, async (hash) => {
    const bytes = await project.store.getImage(hash);
    if (bytes === null) throw new SelfieError("missing-image", `This store has lost image ${hash}, which run ${runId} holds.`);
    await ask(remote, `${route}/images/${hash}`, { method: "PUT", body: bytes as Uint8Array<ArrayBuffer> });
  });
  for (const group of chunks(recordedIn(held), SYNC_LIMITS.snapshots)) {
    await askJson(remote, `${route}/runs/${runId}/snapshots`, "POST", { snapshots: group });
  }
  await askJson(remote, `${route}/runs/${runId}/finish`, "POST", { count: held.length, finishedAt });
  return missing.length;
}

/** Sends a run, by the order in `docs/specs/sync.md` -> Pushing and pulling. */
export async function push(project: Project, remote: Remote, { run: given, accept, native }: { readonly run: string | undefined; readonly accept: boolean | undefined; readonly native: boolean | undefined }): Promise<PushResult> {
  const { snapshots } = project;
  const { environmentId } = await resolveCaptureSettings(project.repo, { native });
  // The newest that can go, since one from a dirty tree would only be refused.
  const newest = (await runsAtHead(project, environmentId)).runs.find(({ status, dirty }) => status !== "recording" && !dirty);
  const runId = given ?? newest?.id;
  if (runId === undefined) throw new SelfieError("unknown-run", "No finished run from a clean tree at HEAD to push. Run selfie record first.");
  const { run, snapshots: held } = await allOfRun((after) => snapshots.readRun(runId, after));
  const route = await projectRoute(project, remote);
  const access = await askJson<ProjectAccess>(remote, route);

  // First, since this is what's refused for a dirty tree or an unpushed commit, and that should cost nothing.
  const { id: _, status: __, finishedAt, failedCount: ___, ...facts } = run;
  const { status } = await askJson<{ status: string }>(remote, `${route}/runs/${runId}`, "PUT", facts satisfies SentRun);
  const total = hashesIn(held).length;
  const sent = status === "recording" ? await uploadRun(project, remote, route, runId, finishedAt, held) : 0;

  let decisions: number | null = null;
  if (access.decide) {
    const decided = decidedIn(held).map(({ story, imageHash, decision, at }): SentDecision => ({ story, imageHash, decision, at }));
    for (const group of chunks(decided, SYNC_LIMITS.decisions)) {
      await askJson(remote, `${route}/decisions`, "POST", { environment: run.environment, decisions: group });
    }
    decisions = decided.length;
  }

  const acceptedHere = (await snapshots.acceptedRunAt(run.gitSha, run.environment)) === runId;
  let goldens: GoldensAnswer | null = null;
  if (accept === true || acceptedHere) {
    // A machine that's never pulled, such as CI, recorded no baseline, so ask which the cloud holds this to.
    const baselineSha = run.baselineSha ?? (await remoteBaseline(project, remote, route, run.environment)).sha;
    goldens = await askJson<GoldensAnswer>(remote, `${route}/goldens`, "POST", { runId, baselineSha, removed: await snapshots.removedFrom(runId, run.baselineSha) });
  }
  return { runId, images: { sent, alreadyThere: total - sent }, decisions, goldens };
}

export interface PullResult {
  readonly sha: string | null;
  readonly environment: string;
  /** The run that's now this commit's goldens here, or null if the remote has none. */
  readonly runId: string | null;
  readonly images: { readonly received: number; readonly alreadyHere: number };
  readonly decisions: number;
  /** The run whose goldens these replaced here, if any did. */
  readonly replaced: string | null;
}

/** Takes a commit's goldens from the remote, which decides them, replacing any here. */
export async function pull(project: Project, remote: Remote, { commit, native }: { readonly commit: string | undefined; readonly native: boolean | undefined }): Promise<PullResult> {
  const { snapshots, store } = project;
  const { environmentId: environment } = await resolveCaptureSettings(project.repo, { native });
  const route = await projectRoute(project, remote);
  const sha = commit ?? (await remoteBaseline(project, remote, route, environment)).sha;
  const nothing = { sha, environment, runId: null, images: { received: 0, alreadyHere: 0 }, decisions: 0, replaced: null };
  if (sha === null) return nothing;
  const { runId } = await askJson<{ runId: string | null }>(remote, `${route}/goldens?${new URLSearchParams({ sha, environment })}`);
  if (runId === null) return nothing;
  // Already here, so there's nothing to read. A shared limit pays for every pull CI makes.
  const before = await snapshots.acceptedRunAt(sha, environment);
  if (before === runId) return { ...nothing, runId };

  const { run, snapshots: held } = await allOfRun((after) => askJson<RunPage>(remote, `${route}/runs/${runId}?${new URLSearchParams({ after })}`));
  const hashes = hashesIn(held);
  const missing = await store.missingImages(hashes);
  await mapConcurrently(missing, IMAGES_AT_ONCE, async (hash) => {
    const response = await ask(remote, `${route}/images/${hash}`);
    await store.putImage(new Uint8Array(await response.arrayBuffer()), hash);
  });

  const { status } = await snapshots.receiveRun(run);
  if (status === "recording") {
    for (const group of chunks(recordedIn(held), SYNC_LIMITS.snapshots)) await snapshots.recordSnapshots(runId, group);
    await snapshots.finishRun(runId, held.length, run.finishedAt ?? undefined);
  }
  const decided = decidedIn(held);
  await snapshots.mergeDecisions(run.environment, decided);
  await snapshots.adoptGoldens(runId);
  return { sha, environment, runId, images: { received: missing.length, alreadyHere: hashes.length - missing.length }, decisions: decided.length, replaced: before };
}

/**
 * The nearest of a local baseline and the remote's. If the remote can't answer, the local answer
 * stands, and says so, so that nothing fails because of the network. `source` is whether this store
 * holds those goldens, or the remote alone does, and a pull would fetch them.
 */
export async function findBaselineWithRemote(
  project: Project,
  remote: Remote,
  environment: string,
): Promise<BaselineSearch & { readonly source: "local" | "remote" | null; readonly remoteError: string | null }> {
  const local = (shas: readonly string[]) => project.snapshots.firstWithGoldens(shas, environment);
  const sourced = async (search: BaselineSearch, remoteError: string | null) => ({
    ...search,
    source: search.sha === null ? null : (await local([search.sha])) === null ? ("remote" as const) : ("local" as const),
    remoteError,
  });
  try {
    const route = await projectRoute(project, remote);
    const search = await walkToBaseline(project.repo, async (shas) => {
      const [here, there] = await Promise.all([local(shas), remoteFirst(remote, route, shas, environment)]);
      return shas.find((sha) => sha === here || sha === there.sha) ?? null;
    });
    return await sourced(search, null);
  } catch (error) {
    if (!(error instanceof RemoteError)) throw error;
    return sourced(await findBaseline(project, environment), error.message);
  }
}
