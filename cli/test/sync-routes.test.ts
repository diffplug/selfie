// The sync routes over a real store, with a stand-in for what GitHub would say. See docs/specs/sync.md.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodePng } from "../src/png.ts";
import { openProject, type Project } from "../src/project.ts";
import { createSyncApi, type SyncAccess } from "selfie-ui/sync";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createHarness, RED, GREEN, BLUE, solid, type Color, type Harness } from "./support.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

const NOW = 1_000_000;
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const ENV = "container-linux-arm64-0123456789abcdef";
const BATCH = "11111111-1111-4111-8111-111111111111";
const OTHER_BATCH = "22222222-2222-4222-8222-222222222222";

const UNKNOWN_HASH = "f".repeat(64);
const PUSHED = new Set([SHA, OTHER_SHA]);

const ACCESS: Readonly<Record<string, SyncAccess>> = {
  writer: { view: true, upload: true, decider: "writer-login" },
  ci: { view: false, upload: true, decider: null },
  reader: { view: true, upload: false, decider: null },
  nobody: { view: false, upload: false, decider: null },
};

let h: Harness;
let cloud: Project;
let home: string;
let app: ReturnType<typeof createSyncApi>;

const send = (method: string, route: string, token: string, body?: unknown) =>
  app.request(`/projects/42${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
  });

const png = (color: Color) => encodePng(solid(4, 4, color));
const putImage = async (color: Color, token = "writer") => {
  const bytes = await png(color);
  const { hash } = await cloud.store.putImage(bytes);
  return { hash, response: await send("PUT", `/images/${hash}`, token, bytes) };
};

const batchFacts = (overrides: Record<string, unknown> = {}) => ({
  gitSha: SHA,
  environment: ENV,
  startedAt: 500,
  dirty: false,
  storyFilter: null,
  reusedFromBatch: null,
  scale: 1,
  viewport: { width: 1200, height: 900 },
  ...overrides,
});

/** A finished batch here, of story `a` at this image. */
async function sendBatch(id = BATCH, color: Color = RED, overrides: Record<string, unknown> = {}) {
  const { hash } = await putImage(color);
  expect((await send("PUT", `/batches/${id}`, "writer", batchFacts(overrides))).status).toBe(200);
  expect((await send("POST", `/batches/${id}/renders`, "writer", { renders: [{ story: "a", imageHash: hash }] })).status).toBe(200);
  expect((await send("POST", `/batches/${id}/finish`, "writer", { count: 1, finishedAt: 600 })).status).toBe(200);
  return hash;
}

const approve = (hash: string, at = 700) => send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "approved", at, gitSha: SHA, batchId: BATCH }] });
const goldens = (body: unknown, token = "writer") => send("POST", "/goldens", token, body);

beforeEach(async () => {
  h = await createHarness();
  home = await mkdtemp(path.join(tmpdir(), "selfie-cloud-"));
  cloud = await openProject({ cwd: h.repo, env: { SELFIE_HOME: home } });
  app = createSyncApi({
    now: () => NOW,
    maxImageBytes: 10_000,
    // With no token, it's a public repository's anonymous viewer.
    open: async (project, token) => {
      const access = project === "42" ? ACCESS[token ?? "reader"] : undefined;
      return access === undefined ? null : { access, batches: cloud.batches, store: cloud.store, hasCommit: async (sha) => PUSHED.has(sha) };
    },
    findProject: async (owner, name) => (owner === "diffplug" && name === "selfie" ? "42" : null),
  });
});
afterEach(async () => {
  cloud.close();
  await rm(home, { recursive: true, force: true });
  await h.destroy();
});

describe("who may ask", () => {
  test("someone who can do nothing there gets the same 404 as for no such project", async () => {
    const nobody = await send("GET", "", "nobody");
    const elsewhere = await app.request("/projects/99", { headers: { authorization: "Bearer writer" } });
    expect(nobody.status).toBe(404);
    expect(await nobody.json()).toEqual(await elsewhere.json());
  });

  test("says what a token may do", async () => {
    expect(await (await send("GET", "", "ci")).json()).toEqual({ view: false, upload: true, decide: false });
    expect(await (await send("GET", "", "writer")).json()).toEqual({ view: true, upload: true, decide: true });
  });

  test("someone who can do something, but not this, gets a 403", async () => {
    expect((await send("POST", "/images/missing", "reader", { hashes: [] })).status).toBe(403);
    expect((await send("POST", "/decisions", "ci", { environment: ENV, decisions: [] })).status).toBe(403);
    expect((await send("GET", `/batches/${BATCH}`, "ci")).status).toBe(403);
  });

  test("a token from a cookie doesn't count", async () => {
    const response = await app.request("/projects/42/images/missing", { method: "POST", headers: { cookie: "token=writer", "content-type": "application/json" }, body: JSON.stringify({ hashes: [] }) });
    expect(response.status).toBe(403);
  });

  test("finds a repository's project, and says nothing of one it can't", async () => {
    expect(await (await app.request("/repositories/diffplug/selfie")).json()).toEqual({ project: "42" });
    expect((await app.request("/repositories/diffplug/secret")).status).toBe(404);
  });
});

describe("images", () => {
  test("says which it lacks, and takes them under their own hash", async () => {
    const hash = UNKNOWN_HASH;
    expect(await (await send("POST", "/images/missing", "ci", { hashes: [hash] })).json()).toEqual({ missing: [hash] });
    const { response } = await putImage(RED, "ci");
    expect(response.status).toBe(200);
  });

  test("takes bytes under the hash they're sent with, unread, and the first ones stay", async () => {
    const first = await png(BLUE);
    expect((await send("PUT", `/images/${UNKNOWN_HASH}`, "writer", first)).status).toBe(200);
    expect(await (await send("POST", "/images/missing", "writer", { hashes: [UNKNOWN_HASH] })).json()).toEqual({ missing: [] });
    expect((await send("PUT", `/images/${UNKNOWN_HASH}`, "writer", await png(RED))).status).toBe(200);
    expect(new Uint8Array(await (await send("GET", `/images/${UNKNOWN_HASH}`, "reader")).arrayBuffer())).toEqual(new Uint8Array(first));
  });

  test("refuses what no store keeps, and what isn't a hash", async () => {
    const junk = await send("PUT", `/images/${UNKNOWN_HASH}`, "writer", new Uint8Array([1, 2, 3]));
    expect(junk.status).toBe(400);
    expect(await junk.json()).toMatchObject({ error: { code: "bad-image" } });
    expect(await (await send("POST", "/images/missing", "writer", { hashes: [UNKNOWN_HASH] })).json()).toEqual({ missing: [UNKNOWN_HASH] });
    expect((await send("PUT", "/images/nope", "writer", await png(RED))).status).toBe(400);
  });

  test("refuses one too big to take, before reading it", async () => {
    const response = await app.request(`/projects/42/images/${UNKNOWN_HASH}`, {
      method: "PUT",
      headers: { authorization: "Bearer writer", "content-length": "10001" },
      body: new Uint8Array(10_001),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "image-too-large" } });
  });

  test("a viewer can read one, kept privately", async () => {
    const { hash } = await putImage(RED);
    const response = await send("GET", `/images/${hash}`, "reader");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await send("GET", `/images/${UNKNOWN_HASH}`, "reader")).status).toBe(404);
  });

  test("an anonymous caller with a bad body gets the same 404 as anyone, not a 400", async () => {
    const response = await app.request("/projects/99/goldens", { method: "POST", body: "not json" });
    expect(response.status).toBe(404);
  });

  test("refuses too many at once", async () => {
    const hashes = Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(64, "f"));
    expect((await send("POST", "/images/missing", "writer", { hashes })).status).toBe(400);
  });
});

describe("batches", () => {
  test("keeps a batch's identity and its times, and reads it back", async () => {
    const hash = await sendBatch();
    const page = (await (await send("GET", `/batches/${BATCH}`, "reader")).json()) as any;
    expect(page.batch).toMatchObject({ id: BATCH, gitSha: SHA, startedAt: 500, finishedAt: 600, status: "complete" });
    expect(page.renders).toEqual([{ story: "a", imageHash: hash, decision: null }]);
    expect(page.next).toBeNull();
  });

  test("refuses a commit the repository doesn't have, and a dirty tree, and holds nothing", async () => {
    const unpushed = "c".repeat(40);
    const response = await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ gitSha: unpushed }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "commit-not-pushed" } });
    expect(await (await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ dirty: true }))).json()).toMatchObject({ error: { code: "batch-dirty" } });
    expect(await cloud.batches.getBatch(BATCH)).toBeNull();
  });

  test("sending one again carries on, and a finished one says so", async () => {
    await sendBatch();
    expect(await (await send("PUT", `/batches/${BATCH}`, "writer", batchFacts())).json()).toEqual({ status: "complete" });
  });

  test("refuses a different batch under an ID it holds", async () => {
    await sendBatch();
    const response = await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ gitSha: OTHER_SHA }));
    expect(await response.json()).toMatchObject({ error: { code: "batch-conflict" } });
  });

  test("a partly sent batch can't be read, and can be finished by sending it again", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/batches/${BATCH}`, "writer", batchFacts());
    expect(await (await send("GET", `/batches/${BATCH}`, "reader")).json()).toMatchObject({ error: { code: "batch-not-finished" } });
    expect((await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 1, finishedAt: 600 })).status).toBe(409);
    await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: hash }] });
    await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: hash }] });
    expect(await (await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 1, finishedAt: 600 })).json()).toEqual({ status: "complete" });
  });

  test("a batch's times can't be later than now, and a resend keeps the first", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ startedAt: NOW + 5 }));
    expect((await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ startedAt: NOW + 5 }))).status).toBe(200);
    await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: hash }] });
    await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 1, finishedAt: NOW + 5 });
    expect(await cloud.batches.getBatch(BATCH)).toMatchObject({ startedAt: NOW, finishedAt: NOW });
  });

  test("won't take an image it doesn't hold", async () => {
    await send("PUT", `/batches/${BATCH}`, "writer", batchFacts());
    const response = await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: UNKNOWN_HASH }] });
    expect(await response.json()).toMatchObject({ error: { code: "unknown-image" } });
  });

  test("keeps a failure with or without an image", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/batches/${BATCH}`, "writer", batchFacts());
    await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", failure: "boom" }, { story: "b", imageHash: hash, failure: "threw" }] });
    await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 2, finishedAt: 600 });
    const page = (await (await send("GET", `/batches/${BATCH}`, "reader")).json()) as any;
    expect(page.renders).toEqual([{ story: "a", failure: "boom", decision: null }, { story: "b", imageHash: hash, failure: "threw", decision: null }]);
  });

  test("keeps the window a story laid out in, if it was its own", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/batches/${BATCH}`, "writer", batchFacts());
    await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: hash, viewport: { width: 414, height: 896 } }, { story: "b", imageHash: hash }] });
    expect((await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "c", imageHash: hash, viewport: { width: 0, height: 896 } }] })).status).toBe(400);
    await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 2, finishedAt: 600 });
    const page = (await (await send("GET", `/batches/${BATCH}`, "reader")).json()) as any;
    expect(page.batch.viewport).toEqual({ width: 1200, height: 900 });
    expect(page.renders).toEqual([{ story: "a", imageHash: hash, viewport: { width: 414, height: 896 }, decision: null }, { story: "b", imageHash: hash, decision: null }]);
  });

  test("refuses what isn't a batch", async () => {
    expect((await send("PUT", "/batches/nope", "writer", batchFacts())).status).toBe(400);
    expect((await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ gitSha: "nope" }))).status).toBe(400);
    expect((await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ scale: "big" }))).status).toBe(400);
    expect((await send("PUT", `/batches/${BATCH}`, "writer", batchFacts({ viewport: null }))).status).toBe(400);
    expect((await send("GET", `/batches/${OTHER_BATCH}`, "reader")).status).toBe(404);
  });
});

describe("decisions", () => {
  const decisionOn = async () => ((await (await send("GET", `/batches/${BATCH}`, "reader")).json()) as any).renders[0].decision;

  test("are by whoever is pushing, whatever the client says", async () => {
    const hash = await sendBatch();
    await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "approved", actor: "someone-else", at: 700, gitSha: SHA, batchId: BATCH }] });
    expect(await decisionOn()).toEqual({ decision: "approved", actor: "writer-login", at: 700, gitSha: SHA, batchId: BATCH });
  });

  test("the latest wins, and a later one can't be later than now", async () => {
    const hash = await sendBatch();
    await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "rejected", at: NOW + 999, gitSha: SHA, batchId: BATCH }] });
    expect(await decisionOn()).toEqual({ decision: "rejected", actor: "writer-login", at: NOW, gitSha: SHA, batchId: BATCH });
    await approve(hash, NOW + 1);
    expect((await decisionOn()).decision).toBe("rejected");
  });

  test("refuses what isn't a decision", async () => {
    expect((await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: "nope", decision: "approved", at: 1, gitSha: SHA, batchId: BATCH }] })).status).toBe(400);
    expect((await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: UNKNOWN_HASH, decision: "maybe", at: 1, gitSha: SHA, batchId: BATCH }] })).status).toBe(400);
  });
});

describe("goldens", () => {
  test("a person's approval, and then CI can make them, with nothing to remove", async () => {
    const hash = await sendBatch();
    await approve(hash);
    expect(await (await goldens({ batchId: BATCH, baselineSha: null, removed: [] }, "ci")).json()).toEqual({ outcome: "accepted", acceptedBatchId: BATCH, refusal: null });
    expect(await cloud.batches.acceptedBatchAt(SHA, ENV)).toBe(BATCH);
  });

  test("are refused for what nobody approved, and leave the batch", async () => {
    await sendBatch();
    expect(await (await goldens({ batchId: BATCH, baselineSha: null, removed: [] }, "ci")).json()).toMatchObject({ outcome: "refused", refusal: { code: "not-approved" } });
    expect(await cloud.batches.acceptedBatchAt(SHA, ENV)).toBeNull();
    expect(await cloud.batches.getBatch(BATCH)).not.toBeNull();
  });

  test("the same batch again is fine", async () => {
    await approve(await sendBatch());
    await goldens({ batchId: BATCH, baselineSha: null, removed: [] });
    expect(await (await goldens({ batchId: BATCH, baselineSha: null, removed: [] })).json()).toEqual({ outcome: "already", acceptedBatchId: BATCH, refusal: null });
  });

  test("a different batch never replaces them", async () => {
    await approve(await sendBatch());
    await goldens({ batchId: BATCH, baselineSha: null, removed: [] });
    await approve(await sendBatch(OTHER_BATCH, GREEN));
    expect(await (await goldens({ batchId: OTHER_BATCH, baselineSha: null, removed: [] })).json()).toMatchObject({ outcome: "conflict", acceptedBatchId: BATCH });
    expect(await cloud.batches.acceptedBatchAt(SHA, ENV)).toBe(BATCH);
  });

  describe("that remove something", () => {
    beforeEach(async () => {
      const { hash: a } = await putImage(RED);
      const { hash: b } = await putImage(BLUE);
      await send("PUT", `/batches/${BATCH}`, "writer", batchFacts());
      await send("POST", `/batches/${BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: a }, { story: "b", imageHash: b }] });
      await send("POST", `/batches/${BATCH}/finish`, "writer", { count: 2, finishedAt: 600 });
      await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: a, decision: "approved", at: 700, gitSha: SHA, batchId: BATCH }, { story: "b", imageHash: b, decision: "approved", at: 700, gitSha: SHA, batchId: BATCH }] });
      await goldens({ batchId: BATCH, baselineSha: null, removed: [] });
      await send("PUT", `/batches/${OTHER_BATCH}`, "writer", batchFacts({ gitSha: OTHER_SHA }));
      await send("POST", `/batches/${OTHER_BATCH}/renders`, "writer", { renders: [{ story: "a", imageHash: a }] });
      await send("POST", `/batches/${OTHER_BATCH}/finish`, "writer", { count: 1, finishedAt: 800 });
    });

    test("need someone who may decide", async () => {
      expect((await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: ["b"] }, "ci")).status).toBe(403);
    });

    test("are refused if nothing was named, whoever asks", async () => {
      expect(await (await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: [] }, "ci")).json()).toMatchObject({ outcome: "refused", refusal: { code: "wrong-removed" } });
    });

    test("are refused for naming something else", async () => {
      expect(await (await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: ["c"] })).json()).toMatchObject({ outcome: "refused", refusal: { code: "wrong-removed" } });
    });

    test("go through for naming just what they remove", async () => {
      expect(await (await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: ["b"] })).json()).toMatchObject({ outcome: "accepted" });
    });
  });

  test("whose baseline isn't here are refused, saying so", async () => {
    const hash = await sendBatch(BATCH, RED);
    await approve(hash);
    expect(await (await goldens({ batchId: BATCH, baselineSha: OTHER_SHA, removed: [] })).json()).toMatchObject({ outcome: "refused", refusal: { code: "no-goldens" } });
  });

  test("hold a batch to whichever goldens the sender names, since CI records no baseline", async () => {
    await approve(await sendBatch());
    await goldens({ batchId: BATCH, baselineSha: null, removed: [] });
    // The same image, at another commit, with no approval or recorded baseline of its own.
    await sendBatch(OTHER_BATCH, RED, { gitSha: OTHER_SHA });
    await cloud.batches.mergeDecisions(ENV, []);
    expect(await (await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: [] }, "ci")).json()).toMatchObject({ outcome: "accepted" });
  });

  test("of a batch from nowhere are a 404", async () => {
    expect((await goldens({ batchId: OTHER_BATCH, baselineSha: SHA, removed: [] })).status).toBe(404);
  });

  test("CI can find which commits have them, and no more", async () => {
    await approve(await sendBatch());
    await goldens({ batchId: BATCH, baselineSha: null, removed: [] });
    expect(await (await send("POST", "/goldens/first", "ci", { shas: [OTHER_SHA, SHA], environment: ENV })).json()).toEqual({ sha: SHA });
    expect(await (await send("GET", `/goldens?sha=${SHA}&environment=${ENV}`, "ci")).json()).toEqual({ batchId: BATCH });
    expect((await send("GET", `/batches/${BATCH}`, "ci")).status).toBe(403);
  });
});
