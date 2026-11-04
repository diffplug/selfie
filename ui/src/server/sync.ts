// The routes other stores sync through, over `RenderBatches` and `Store` and whatever the platform says
// about access. See `docs/specs/sync.md`, which owns what they do and why. Nothing here knows GitHub,
// so they run on any platform, and are tested with a stand-in for it.
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { assertViewport, ImageDecodeError, isGitSha, isImageHash, isBatchId, BatchError, type ReceivedDecision, type ReceivedBatch, type BuiltStorybooks, type StoredDiffs, type ReceivingStore, type RecordedRender, type RenderBatches, type StoryFilter, type Viewport } from "selfie-store";
import { SYNC_LIMITS, type GoldensAnswer, type ProjectAccess } from "../shared/sync-api.ts";
import { afterResponse, failure, imageResponse, INTERNAL_ERROR, noStoreByDefault } from "./http.ts";

/** What a token may do in a project. */
export interface SyncAccess {
  readonly view: boolean;
  readonly upload: boolean;
  /** Who a decision from this token is by, or null if it can't decide. */
  readonly decider: string | null;
}

/** One project, as this token sees it. */
export interface SyncProject {
  readonly access: SyncAccess;
  readonly batches: RenderBatches;
  readonly store: ReceivingStore;
  readonly storybooks: BuiltStorybooks;
  readonly diffs: StoredDiffs;
  /** Whether the project's repository has this commit where anyone may see it. */
  hasCommit(gitSha: string): Promise<boolean>;
  /** Told when what a commit's batch reads as may have changed, so it can say so where people look. */
  commitChanged?(gitSha: string, environment: string): Promise<void>;
}

/** What the routes are given by a platform. */
export interface SyncHost {
  /** A project this token can do something in, or null, whether or not it exists. */
  open(project: string, token: string | null): Promise<SyncProject | null>;
  /** The project of this repository, or null if this token can't know, whether or not it exists. */
  findProject(owner: string, name: string, token: string | null): Promise<string | null>;
  /** The largest image file to read, since a request holds a whole one in memory. */
  readonly maxImageBytes?: number;
  readonly now?: () => number;
}

const BATCH_PAGE = 1_000;
const DEFAULT_MAX_IMAGE_BYTES = 64 * 1024 * 1024;

class Refusal extends Error {
  readonly code: string;
  readonly status: ContentfulStatusCode;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const badRequest = (message: string) => new Refusal(400, "bad-request", message);
/** The same whether it doesn't exist or can't be seen, so nobody learns which. */
const notFound = () => new Refusal(404, "not-found", "This project doesn't exist, or you can't see it.");

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("Expected a JSON object.");
  return value as Record<string, unknown>;
};

async function bodyOf(context: Context): Promise<Record<string, unknown>> {
  return asRecord(await context.req.json().catch(() => null));
}

function listOf(value: unknown, most: number, what: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > most) throw badRequest(`${what} must be a list of at most ${most}.`);
  return value;
}

const readText = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value === "") throw badRequest(`${what} must be text.`);
  return value;
};

const orNull = <T>(value: unknown, read: (present: unknown) => T): T | null => (value === null || value === undefined ? null : read(value));

function readSha(value: unknown, what: string): string {
  if (typeof value !== "string" || !isGitSha(value)) throw badRequest(`${what} must be a full Git SHA.`);
  return value;
}

function readBatchId(value: unknown): string {
  if (typeof value !== "string" || !isBatchId(value)) throw badRequest("That isn't a batch ID.");
  return value;
}

const readWhole = (value: unknown, what: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw badRequest(`${what} must be a whole number.`);
  return value as number;
};

function readHash(value: unknown): string {
  if (typeof value !== "string" || !isImageHash(value)) throw badRequest("That isn't an image hash.");
  return value;
}

function readViewport(value: unknown): Viewport {
  const { width, height } = asRecord(value);
  const viewport = { width: width as number, height: height as number };
  assertViewport(viewport);
  return viewport;
}

function recordedRender(value: unknown): RecordedRender {
  const { story, imageHash, failure, viewport } = asRecord(value);
  const named = { story: readText(story, "story"), viewport: orNull(viewport, readViewport) ?? undefined };
  if (imageHash === null || imageHash === undefined) return { ...named, failure: readText(failure, "failure") };
  return { ...named, imageHash: readHash(imageHash), failure: orNull(failure, (present) => readText(present, "failure")) ?? undefined };
}

/** A batch's facts as a sender states them, whose times can't be later than now. */
function receivedBatch(id: string, body: Record<string, unknown>, now: number): ReceivedBatch {
  const { gitSha, environment, startedAt, dirty, storyFilter, reusedFromBatch, scale, viewport, branch } = body;
  if (typeof dirty !== "boolean") throw badRequest("dirty must be true or false.");
  if (typeof scale !== "number") throw badRequest("scale must be a number.");
  return {
    id,
    gitSha: readSha(gitSha, "gitSha"),
    environment: readText(environment, "environment"),
    startedAt: Math.min(readWhole(startedAt, "startedAt"), now),
    dirty,
    storyFilter: (storyFilter ?? null) as StoryFilter | null,
    reusedFromBatch: orNull(reusedFromBatch, (batch) => readText(batch, "reusedFromBatch")),
    scale,
    viewport: readViewport(viewport),
    branch: orNull(branch, (name) => readText(name, "branch")),
  };
}

function receivedDecision(value: unknown, decider: string, now: number): ReceivedDecision {
  const { story, imageHash, decision, at, gitSha, batchId } = asRecord(value);
  if (decision !== "approved" && decision !== "rejected") throw badRequest('decision must be "approved" or "rejected".');
  return { story: readText(story, "story"), imageHash: readHash(imageHash), decision, actor: decider, at: Math.min(readWhole(at, "at"), now), gitSha: readSha(gitSha, "gitSha"), batchId: readBatchId(batchId) };
}

/** The same stories, in any order. */
const sameStories = (p: readonly string[], q: readonly string[]) => p.length === q.length && [...p].sort().join("\0") === [...q].sort().join("\0");

const refused = (code: string, message: string): GoldensAnswer => ({ outcome: "refused", acceptedBatchId: null, refusal: { code, message } });

/** The cloud decides a SHA's goldens: `docs/specs/sync.md` -> Goldens. */
async function makeGoldens({ batches }: SyncProject, id: string, baselineSha: string | null, removed: readonly string[]): Promise<GoldensAnswer> {
  const batch = await batches.getBatch(id);
  if (batch === null) throw new Refusal(404, "unknown-batch", `No batch ${id} in this project.`);
  const accepted = await batches.acceptedBatchAt(batch.gitSha, batch.environment);
  if (accepted === id) return { outcome: "already", acceptedBatchId: id, refusal: null };
  if (accepted !== null) {
    return { outcome: "conflict", acceptedBatchId: accepted, refusal: { code: "goldens-conflict", message: `Batch ${accepted} is already the goldens of ${batch.gitSha}, and a push never replaces them.` } };
  }
  try {
    const found = await batches.removedFrom(id, baselineSha);
    if (!sameStories(found, removed)) {
      return refused("wrong-removed", `This would remove ${found.length} goldens here, and not the ${removed.length} you named: ${found.join(", ") || "none"}.`);
    }
    if (!(await batches.acceptBatch(id, baselineSha, found.length))) {
      return refused("not-approved", "Some of this batch's images are neither the same as the baseline's, nor approved.");
    }
    return { outcome: "accepted", acceptedBatchId: id, refusal: null };
  } catch (error) {
    if (error instanceof BatchError) return refused(error.code, error.message);
    throw error;
  }
}

/** The routes, to mount under `/api`. */
export function createSyncApi(host: SyncHost): Hono {
  const api = new Hono();
  const now = host.now ?? Date.now;
  const maxImageBytes = host.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  const tokenOf = (context: Context) => context.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? null;

  /** The project, if this token can do anything there, or else nobody learns it exists. */
  const projectOf = async (context: Context): Promise<SyncProject> => {
    const project = await host.open(context.req.param("project") ?? "", tokenOf(context));
    if (project === null) throw notFound();
    const { view, upload, decider } = project.access;
    if (!view && !upload && decider === null) throw notFound();
    return project;
  };
  const refuseUnless = (allowed: boolean) => {
    if (!allowed) throw new Refusal(403, "not-allowed", "You can't do this in this project.");
  };
  const viewable = async (context: Context) => {
    const project = await projectOf(context);
    refuseUnless(project.access.view);
    return project;
  };
  const uploadable = async (context: Context) => {
    const project = await projectOf(context);
    refuseUnless(project.access.upload);
    return project;
  };
  /** What says which commits have goldens tells CI its baseline, and nothing else about a private project. */
  const knowsGoldens = async (context: Context) => {
    const project = await projectOf(context);
    refuseUnless(project.access.view || project.access.upload);
    return project;
  };

  /** Refused before reading it where its length says so, since it can't be checked without holding it. */
  const readLimited = async (context: Context, kind: "image" | "file" = "file") => {
    const tooLarge = () => new Refusal(413, `${kind}-too-large`, `This server takes ${kind}s of at most ${maxImageBytes} bytes.`);
    if (Number(context.req.header("content-length") ?? 0) > maxImageBytes) throw tooLarge();
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    if (bytes.length > maxImageBytes) throw tooLarge();
    return bytes;
  };

  api.onError((error, context) => {
    if (error instanceof Refusal) return context.json(failure(error.code, error.message), error.status);
    if (error instanceof BatchError) return context.json(failure(error.code, error.message), error.code === "unknown-batch" || error.code === "unknown-image" ? 404 : 409);
    if (error instanceof RangeError || error instanceof TypeError) return context.json(failure("bad-request", error.message), 400);
    console.error(error);
    return context.json(INTERNAL_ERROR, 500);
  });

  api.use(noStoreByDefault);

  api.get("/repositories/:owner/:name", async (context) => {
    const { owner, name } = context.req.param();
    const project = await host.findProject(owner, name, tokenOf(context));
    if (project === null) throw notFound();
    return context.json({ project });
  });

  api.get("/projects/:project", async (context) => {
    const { view, upload, decider } = (await projectOf(context)).access;
    return context.json({ view, upload, decide: decider !== null } satisfies ProjectAccess);
  });

  api.post("/projects/:project/images/missing", async (context) => {
    const { store } = await uploadable(context);
    const hashes = listOf((await bodyOf(context)).hashes, SYNC_LIMITS.hashes, "hashes").map(readHash);
    return context.json({ missing: await store.missingImages(hashes) });
  });

  api.put("/projects/:project/images/:hash", async (context) => {
    const { store } = await uploadable(context);
    const hash = readHash(context.req.param("hash"));
    const bytes = await readLimited(context, "image");
    try {
      await store.receiveImage(bytes, hash);
    } catch (error) {
      if (error instanceof ImageDecodeError) throw new Refusal(400, "bad-image", error.message);
      throw error;
    }
    return context.json({ hash });
  });

  api.get("/projects/:project/images/:hash", async (context) => {
    const { store } = await viewable(context);
    const bytes = await store.getImage(readHash(context.req.param("hash")));
    if (bytes === null) throw new Refusal(404, "unknown-image", "This project doesn't hold that image.");
    return imageResponse(context, bytes);
  });

  api.put("/projects/:project/batches/:id", async (context) => {
    const project = await uploadable(context);
    const { batches } = project;
    const id = readBatchId(context.req.param("id"));
    const received = receivedBatch(id, await bodyOf(context), now());
    if (received.dirty) throw new Refusal(409, "batch-dirty", "This batch is from a dirty tree, so it may show work that's in no commit.");
    const existing = await batches.getBatch(id);
    if (existing?.gitSha !== received.gitSha && !(await project.hasCommit(received.gitSha))) {
      throw new Refusal(409, "commit-not-pushed", `The repository doesn't have ${received.gitSha}. Push your commit, then this batch.`);
    }
    // A resend keeps the time it was first given, which its clock may since have passed.
    const { status } = await batches.receiveBatch(existing === null ? received : { ...received, startedAt: existing.startedAt });
    return context.json({ status });
  });

  api.post("/projects/:project/batches/:id/renders", async (context) => {
    const { batches } = await uploadable(context);
    const items = listOf((await bodyOf(context)).renders, SYNC_LIMITS.renders, "renders").map(recordedRender);
    await batches.recordRenders(readBatchId(context.req.param("id")), items);
    return context.json({ recorded: items.length });
  });

  api.post("/projects/:project/batches/:id/finish", async (context) => {
    const project = await uploadable(context);
    const { count, finishedAt } = await bodyOf(context);
    const { status, gitSha, environment } = await project.batches.finishBatch(readBatchId(context.req.param("id")), readWhole(count, "count"), Math.min(readWhole(finishedAt, "finishedAt"), now()));
    if (project.commitChanged !== undefined) await afterResponse(context, project.commitChanged(gitSha, environment));
    return context.json({ status });
  });

  api.get("/projects/:project/batches/:id", async (context) => {
    const { batches } = await viewable(context);
    return context.json(await batches.readBatch(readBatchId(context.req.param("id")), context.req.query("after") ?? "", BATCH_PAGE));
  });

  api.post("/projects/:project/decisions", async (context) => {
    const project = await projectOf(context);
    const { batches, access } = project;
    refuseUnless(access.decider !== null);
    const { environment, decisions } = await bodyOf(context);
    const at = now();
    const named = readText(environment, "environment");
    const received = listOf(decisions, SYNC_LIMITS.decisions, "decisions").map((decision) => receivedDecision(decision, access.decider!, at));
    await batches.mergeDecisions(named, received);
    if (project.commitChanged !== undefined) {
      await afterResponse(context, Promise.all([...new Set(received.map(({ gitSha }) => gitSha))].map((gitSha) => project.commitChanged!(gitSha, named))).then(() => undefined));
    }
    return context.json({ merged: received.length });
  });

  api.post("/projects/:project/commits", async (context) => {
    const { batches } = await uploadable(context);
    const commits = listOf((await bodyOf(context)).commits, SYNC_LIMITS.commits, "commits").map((value) => {
      const { sha, parents } = asRecord(value);
      return { sha: readSha(sha, "sha"), parents: listOf(parents, 64, "parents").map((parent) => readSha(parent, "A parent")) };
    });
    await batches.recordCommits(commits);
    return context.json({ recorded: commits.length });
  });

  api.post("/projects/:project/storybooks/files/missing", async (context) => {
    const { storybooks } = await uploadable(context);
    const hashes = listOf((await bodyOf(context)).hashes, SYNC_LIMITS.hashes, "hashes").map(readHash);
    return context.json({ missing: await storybooks.missingFiles(hashes) });
  });

  api.put("/projects/:project/storybooks/files/:hash", async (context) => {
    const { storybooks } = await uploadable(context);
    const hash = readHash(context.req.param("hash"));
    // Whatever a built Storybook is, a file's name is its bytes' hash, so one file can't stand in for another.
    const kept = await storybooks.putFile(await readLimited(context));
    if (kept !== hash) throw badRequest(`Those bytes hash to ${kept}, not ${hash}.`);
    return context.json({ hash });
  });

  api.get("/projects/:project/storybooks/:build", async (context) => {
    const { storybooks } = await uploadable(context);
    return context.json({ kept: await storybooks.has(readHash(context.req.param("build"))) });
  });

  api.put("/projects/:project/storybooks/:build", async (context) => {
    const { storybooks } = await uploadable(context);
    const build = readHash(context.req.param("build"));
    const files = listOf((await bodyOf(context)).files, 100_000, "files").map((value) => {
      const { path, fileHash } = asRecord(value);
      return { path: readText(path, "path"), fileHash: readHash(fileHash) };
    });
    // A row says every file is here, so it's only written once that's so.
    const missing = await storybooks.missingFiles(files.map(({ fileHash }) => fileHash));
    if (missing.length > 0) throw new Refusal(409, "missing-files", `${missing.length} of this built Storybook's files aren't here yet.`);
    await storybooks.putStorybook(build, files);
    return context.json({ build });
  });

  api.post("/projects/:project/batches/:id/storybook", async (context) => {
    const { storybooks } = await uploadable(context);
    const build = readHash((await bodyOf(context)).build);
    await storybooks.recordBatchStorybook(readBatchId(context.req.param("id")), build);
    return context.json({ build });
  });

  api.get("/projects/:project/batches/:id/diffs/needed", async (context) => {
    const { batches, diffs } = await uploadable(context);
    const { renders } = await batches.compareReached(readBatchId(context.req.param("id")));
    const pairs = renders.flatMap(({ state, imageHash, goldenHash }) => (state === "changed" && imageHash !== null && goldenHash !== null ? [{ current: imageHash, golden: goldenHash }] : []));
    const held = await Promise.all(pairs.map(({ current, golden }) => diffs.has(current, golden)));
    return context.json({ pairs: pairs.filter((_, i) => !held[i]) });
  });

  api.put("/projects/:project/diffs/:current/:golden/image", async (context) => {
    const { diffs } = await uploadable(context);
    const { current, golden } = context.req.param();
    await diffs.putImage(readHash(current), readHash(golden), await readLimited(context));
    return context.json({ stored: true });
  });

  api.put("/projects/:project/diffs/:current/:golden", async (context) => {
    const { diffs } = await uploadable(context);
    const { current, golden } = context.req.param();
    await diffs.putStats(readHash(current), readHash(golden), JSON.stringify(await bodyOf(context)));
    return context.json({ stored: true });
  });

  api.post("/projects/:project/goldens", async (context) => {
    const project = await projectOf(context);
    const { batchId, baselineSha, removed } = await bodyOf(context);
    const named = listOf(removed ?? [], SYNC_LIMITS.renders, "removed").map((story) => readText(story, "A removed story"));
    // With nothing removed, this makes no judgment: docs/specs/sync.md -> Goldens.
    refuseUnless(project.access.decider !== null || (project.access.upload && named.length === 0));
    return context.json(await makeGoldens(project, readBatchId(batchId), orNull(baselineSha, (sha) => readSha(sha, "baselineSha")), named));
  });

  api.get("/projects/:project/goldens", async (context) => {
    const { batches } = await knowsGoldens(context);
    const batchId = await batches.acceptedBatchAt(readSha(context.req.query("sha"), "sha"), readText(context.req.query("environment"), "environment"));
    return context.json({ batchId });
  });

  api.post("/projects/:project/goldens/first", async (context) => {
    const { batches } = await knowsGoldens(context);
    const { shas, environment } = await bodyOf(context);
    const candidates = listOf(shas, SYNC_LIMITS.shas, "shas").map((sha) => readSha(sha, "A SHA"));
    return context.json({ sha: await batches.firstWithGoldens(candidates, readText(environment, "environment")) });
  });

  api.all("*", (context) => context.json(failure("not-found", "No such route."), 404));

  return api;
}
