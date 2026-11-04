// Moving a batch, its images, its decisions, and its goldens between this store and another, through
// the routes in `selfie-ui/sync`. Every step is safe to send again, so a push or pull that dies is
// finished by running it again. See `docs/specs/sync.md`.
import { chunks, ImageDecodeError, ImageHashMismatchError, mapConcurrently, type BatchPage } from "selfie-store";
import { SYNC_LIMITS, type GoldensAnswer, type ProjectAccess, type SentDecision, type SentBatch, type SentRender, type SyncError } from "selfie-ui/sync-api";
import { resolveRenderSettings } from "./config.ts";
import { SelfieError } from "./errors.ts";
import { walkToBaseline } from "./git.ts";
import { normalizeOrigin } from "./paths.ts";
import { batchesAtHead, type Project } from "./project.ts";

/** How many images go at once. Each is decoded to check it, so this bounds memory, as `Store` does. */
const IMAGES_AT_ONCE = 4;

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

async function allOfBatch(read: (after: string) => Promise<BatchPage>): Promise<Pick<BatchPage, "batch" | "renders">> {
  const first = await read("");
  const renders = [...first.renders];
  for (let next = first.next; next !== null; ) {
    const page = await read(next);
    renders.push(...page.renders);
    next = page.next;
  }
  return { batch: first.batch, renders };
}

const hashesIn = (renders: BatchPage["renders"]) => [...new Set(renders.flatMap(({ imageHash }) => imageHash ?? []))];

/** The decisions on a batch's images, wherever they're going. */
const decidedIn = (renders: BatchPage["renders"]) => renders.flatMap(({ story, imageHash, decision }) => (imageHash === undefined || decision === null ? [] : [{ story, imageHash, ...decision }]));

const recordedIn = (renders: BatchPage["renders"]): SentRender[] => renders.map(({ decision: _, ...recorded }) => recorded);

/** The commit the remote would hold these commits to, nearest first. */
const remoteFirst = (remote: Remote, route: string, shas: readonly string[], environment: string) => askJson<{ sha: string | null }>(remote, `${route}/goldens/first`, "POST", { shas, environment });

const remoteBaseline = (project: Project, remote: Remote, route: string, environment: string) =>
  walkToBaseline(project.repo, async (shas) => (await remoteFirst(remote, route, shas, environment)).sha);

export interface PushResult {
  readonly batchId: string;
  readonly images: { readonly sent: number; readonly alreadyThere: number };
  /** Decisions sent, or null if this token can't decide, so none could go. */
  readonly decisions: number | null;
  /** What became of its goldens, or null if none were asked for. */
  readonly goldens: GoldensAnswer | null;
}

/** Says which image and where, for bytes that don't decode to the image their hash names. */
async function notThatImage<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ImageDecodeError || error instanceof ImageHashMismatchError) {
      throw new SelfieError("corrupt-image", `${message}: ${error.message}`);
    }
    throw error;
  }
}

/** What the remote lacks of a batch it's holding, and the batch's renders. Says how many images went. */
async function uploadBatch(project: Project, remote: Remote, route: string, batchId: string, finishedAt: number | null, held: BatchPage["renders"]): Promise<number> {
  const missing: string[] = [];
  for (const group of chunks(hashesIn(held), SYNC_LIMITS.hashes)) {
    missing.push(...(await askJson<{ missing: readonly string[] }>(remote, `${route}/images/missing`, "POST", { hashes: group })).missing);
  }
  await mapConcurrently(missing, IMAGES_AT_ONCE, async (hash) => {
    // The last check an image gets, since the cloud doesn't decode what it's sent.
    const bytes = await notThatImage(project.store.getCheckedImage(hash), `This store's copy of image ${hash} isn't that image, so it can't be pushed`);
    if (bytes === null) throw new SelfieError("missing-image", `This store has lost image ${hash}, which batch ${batchId} holds.`);
    await ask(remote, `${route}/images/${hash}`, { method: "PUT", body: bytes as Uint8Array<ArrayBuffer> });
  });
  for (const group of chunks(recordedIn(held), SYNC_LIMITS.renders)) {
    await askJson(remote, `${route}/batches/${batchId}/renders`, "POST", { renders: group });
  }
  await askJson(remote, `${route}/batches/${batchId}/finish`, "POST", { count: held.length, finishedAt });
  return missing.length;
}

/** Sends a batch, by the order in `docs/specs/sync.md` -> Pushing and pulling. */
export async function push(project: Project, remote: Remote, { batch: given, accept, native }: { readonly batch: string | undefined; readonly accept: boolean | undefined; readonly native: boolean | undefined }): Promise<PushResult> {
  const { batches } = project;
  const { environmentId } = await resolveRenderSettings(project.repo, { native });
  // The newest that can go, since one from a dirty tree would only be refused.
  const newest = (await batchesAtHead(project, environmentId)).batches.find(({ status, dirty }) => status !== "recording" && !dirty);
  const batchId = given ?? newest?.id;
  if (batchId === undefined) throw new SelfieError("unknown-batch", "No finished batch from a clean tree at HEAD to push. Run selfie render first.");
  const { batch, renders: held } = await allOfBatch((after) => batches.readBatch(batchId, after));
  const route = await projectRoute(project, remote);
  const access = await askJson<ProjectAccess>(remote, route);

  // First, since this is what's refused for a dirty tree or an unpushed commit, and that should cost nothing.
  const { id: _, status: __, finishedAt, failedCount: ___, ...facts } = batch;
  const { status } = await askJson<{ status: string }>(remote, `${route}/batches/${batchId}`, "PUT", facts satisfies SentBatch);
  const total = hashesIn(held).length;
  const sent = status === "recording" ? await uploadBatch(project, remote, route, batchId, finishedAt, held) : 0;

  let decisions: number | null = null;
  if (access.decide) {
    const decided = decidedIn(held).map(({ story, imageHash, decision, at }): SentDecision => ({ story, imageHash, decision, at }));
    for (const group of chunks(decided, SYNC_LIMITS.decisions)) {
      await askJson(remote, `${route}/decisions`, "POST", { environment: batch.environment, decisions: group });
    }
    decisions = decided.length;
  }

  const acceptedHere = (await batches.acceptedBatchAt(batch.gitSha, batch.environment)) === batchId;
  let goldens: GoldensAnswer | null = null;
  if (accept === true || acceptedHere) {
    // A machine that's never pulled, such as CI, recorded no baseline, so ask which the cloud holds this to.
    const baselineSha = batch.baselineSha ?? (await remoteBaseline(project, remote, route, batch.environment)).sha;
    goldens = await askJson<GoldensAnswer>(remote, `${route}/goldens`, "POST", { batchId, baselineSha, removed: await batches.removedFrom(batchId, batch.baselineSha) });
  }
  return { batchId, images: { sent, alreadyThere: total - sent }, decisions, goldens };
}

export interface PullResult {
  readonly sha: string | null;
  readonly environment: string;
  /** The batch that's now this commit's goldens here, or null if the remote has none. */
  readonly batchId: string | null;
  readonly images: { readonly received: number; readonly alreadyHere: number };
  readonly decisions: number;
  /** The batch whose goldens these replaced here, if any did. */
  readonly replaced: string | null;
}

/** Takes a commit's goldens from the remote, which decides them, replacing any here. */
export async function pull(project: Project, remote: Remote, { commit, native }: { readonly commit: string | undefined; readonly native: boolean | undefined }): Promise<PullResult> {
  const { batches, store } = project;
  const { environmentId: environment } = await resolveRenderSettings(project.repo, { native });
  const route = await projectRoute(project, remote);
  const sha = commit ?? (await remoteBaseline(project, remote, route, environment)).sha;
  const nothing = { sha, environment, batchId: null, images: { received: 0, alreadyHere: 0 }, decisions: 0, replaced: null };
  if (sha === null) return nothing;
  const { batchId } = await askJson<{ batchId: string | null }>(remote, `${route}/goldens?${new URLSearchParams({ sha, environment })}`);
  if (batchId === null) return nothing;
  // Already here, so there's nothing to read. A shared limit pays for every pull CI makes.
  const before = await batches.acceptedBatchAt(sha, environment);
  if (before === batchId) return { ...nothing, batchId };

  const { batch, renders: held } = await allOfBatch((after) => askJson<BatchPage>(remote, `${route}/batches/${batchId}?${new URLSearchParams({ after })}`));
  const hashes = hashesIn(held);
  const missing = await store.missingImages(hashes);
  await mapConcurrently(missing, IMAGES_AT_ONCE, async (hash) => {
    const response = await ask(remote, `${route}/images/${hash}`);
    await notThatImage(store.putImage(new Uint8Array(await response.arrayBuffer()), hash), `The remote's copy of image ${hash} isn't that image, so it can't be pulled`);
  });

  const { status } = await batches.receiveBatch(batch);
  if (status === "recording") {
    for (const group of chunks(recordedIn(held), SYNC_LIMITS.renders)) await batches.recordRenders(batchId, group);
    await batches.finishBatch(batchId, held.length, batch.finishedAt ?? undefined);
  }
  const decided = decidedIn(held);
  await batches.mergeDecisions(batch.environment, decided);
  await batches.adoptGoldens(batchId);
  return { sha, environment, batchId, images: { received: missing.length, alreadyHere: hashes.length - missing.length }, decisions: decided.length, replaced: before };
}
