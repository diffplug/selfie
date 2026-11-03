// The sync routes over a real store, with a stand-in for what GitHub would say. See docs/specs/sync.md.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodePng } from "../src/png.ts";
import { openProject, type Project } from "../src/project.ts";
import { createSyncApi, type SyncAccess } from "selfie-ui/sync";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createHarness, RED, GREEN, BLUE, solid, type Color, type Harness } from "./support.ts";

const NOW = 1_000_000;
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const ENV = "container-linux-arm64-0123456789abcdef";
const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN = "22222222-2222-4222-8222-222222222222";

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

const runFacts = (overrides: Record<string, unknown> = {}) => ({
  gitSha: SHA,
  environment: ENV,
  startedAt: 500,
  dirty: false,
  baselineSha: null,
  storyFilter: null,
  reusedFromRun: null,
  scale: 1,
  ...overrides,
});

/** A finished run here, of story `a` at this image. */
async function sendRun(id = RUN, color: Color = RED, overrides: Record<string, unknown> = {}) {
  const { hash } = await putImage(color);
  expect((await send("PUT", `/runs/${id}`, "writer", runFacts(overrides))).status).toBe(200);
  expect((await send("POST", `/runs/${id}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: hash }] })).status).toBe(200);
  expect((await send("POST", `/runs/${id}/finish`, "writer", { count: 1, finishedAt: 600 })).status).toBe(200);
  return hash;
}

const approve = (hash: string, at = 700) => send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "approved", at }] });
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
      return access === undefined ? null : { access, snapshots: cloud.snapshots, store: cloud.store, hasCommit: async (sha) => PUSHED.has(sha) };
    },
    findProject: async (owner, name) => (owner === "diffplug" && name === "selfie" ? "42" : null),
  });
});
afterEach(async () => {
  cloud.close();
  await rm(home, { recursive: true, force: true });
  await h.destroy();
});

/** Its hash, found in a store of its own, so the one under test never sees it. */
async function hashOfBytes(bytes: Uint8Array) {
  const other = await openProject({ cwd: h.repo, env: { SELFIE_HOME: path.join(home, "elsewhere") } });
  try {
    return (await other.store.putImage(bytes)).hash;
  } finally {
    other.close();
  }
}

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
    expect((await send("GET", `/runs/${RUN}`, "ci")).status).toBe(403);
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

  test("refuses bytes that aren't the image they're sent as, and what isn't an image", async () => {
    const bytes = await png(BLUE);
    const wrong = await send("PUT", `/images/${UNKNOWN_HASH}`, "writer", bytes);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: { code: "hash-mismatch" } });
    // And what it really was isn't kept.
    const held = new Set(await cloud.store.missingImages([await hashOfBytes(bytes)]));
    expect(held.size).toBe(1);
    const junk = await send("PUT", `/images/${UNKNOWN_HASH}`, "writer", new Uint8Array([1, 2, 3]));
    expect(await junk.json()).toMatchObject({ error: { code: "bad-image" } });
    expect((await send("PUT", "/images/nope", "writer", await png(RED))).status).toBe(400);
  });

  test("refuses one too big to verify, before reading it", async () => {
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

describe("runs", () => {
  test("keeps a run's identity and its times, and reads it back", async () => {
    const hash = await sendRun();
    const page = (await (await send("GET", `/runs/${RUN}`, "reader")).json()) as any;
    expect(page.run).toMatchObject({ id: RUN, gitSha: SHA, startedAt: 500, finishedAt: 600, status: "complete" });
    expect(page.snapshots).toEqual([{ story: "a", imageHash: hash, decision: null }]);
    expect(page.next).toBeNull();
  });

  test("refuses a commit the repository doesn't have, and a dirty tree, and holds nothing", async () => {
    const unpushed = "c".repeat(40);
    const response = await send("PUT", `/runs/${RUN}`, "writer", runFacts({ gitSha: unpushed }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "commit-not-pushed" } });
    expect(await (await send("PUT", `/runs/${RUN}`, "writer", runFacts({ dirty: true }))).json()).toMatchObject({ error: { code: "run-dirty" } });
    expect(await cloud.snapshots.getRun(RUN)).toBeNull();
  });

  test("sending one again carries on, and a finished one says so", async () => {
    await sendRun();
    expect(await (await send("PUT", `/runs/${RUN}`, "writer", runFacts())).json()).toEqual({ status: "complete" });
  });

  test("refuses a different run under an ID it holds", async () => {
    await sendRun();
    const response = await send("PUT", `/runs/${RUN}`, "writer", runFacts({ gitSha: OTHER_SHA }));
    expect(await response.json()).toMatchObject({ error: { code: "run-conflict" } });
  });

  test("a partly sent run can't be read, and can be finished by sending it again", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/runs/${RUN}`, "writer", runFacts());
    expect(await (await send("GET", `/runs/${RUN}`, "reader")).json()).toMatchObject({ error: { code: "run-not-finished" } });
    expect((await send("POST", `/runs/${RUN}/finish`, "writer", { count: 1, finishedAt: 600 })).status).toBe(409);
    await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: hash }] });
    await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: hash }] });
    expect(await (await send("POST", `/runs/${RUN}/finish`, "writer", { count: 1, finishedAt: 600 })).json()).toEqual({ status: "complete" });
  });

  test("a run's times can't be later than now, and a resend keeps the first", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/runs/${RUN}`, "writer", runFacts({ startedAt: NOW + 5 }));
    expect((await send("PUT", `/runs/${RUN}`, "writer", runFacts({ startedAt: NOW + 5 }))).status).toBe(200);
    await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: hash }] });
    await send("POST", `/runs/${RUN}/finish`, "writer", { count: 1, finishedAt: NOW + 5 });
    expect(await cloud.snapshots.getRun(RUN)).toMatchObject({ startedAt: NOW, finishedAt: NOW });
  });

  test("won't take an image it doesn't hold", async () => {
    await send("PUT", `/runs/${RUN}`, "writer", runFacts());
    const response = await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: UNKNOWN_HASH }] });
    expect(await response.json()).toMatchObject({ error: { code: "unknown-image" } });
  });

  test("keeps failures and play errors", async () => {
    const { hash } = await putImage(RED);
    await send("PUT", `/runs/${RUN}`, "writer", runFacts());
    await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", failure: "boom" }, { story: "b", imageHash: hash, playError: "threw" }] });
    await send("POST", `/runs/${RUN}/finish`, "writer", { count: 2, finishedAt: 600 });
    const page = (await (await send("GET", `/runs/${RUN}`, "reader")).json()) as any;
    expect(page.snapshots).toEqual([{ story: "a", failure: "boom", decision: null }, { story: "b", imageHash: hash, playError: "threw", decision: null }]);
  });

  test("refuses what isn't a run", async () => {
    expect((await send("PUT", "/runs/nope", "writer", runFacts())).status).toBe(400);
    expect((await send("PUT", `/runs/${RUN}`, "writer", runFacts({ gitSha: "nope" }))).status).toBe(400);
    expect((await send("PUT", `/runs/${RUN}`, "writer", runFacts({ scale: "big" }))).status).toBe(400);
    expect((await send("GET", `/runs/${OTHER_RUN}`, "reader")).status).toBe(404);
  });
});

describe("decisions", () => {
  const decisionOn = async () => ((await (await send("GET", `/runs/${RUN}`, "reader")).json()) as any).snapshots[0].decision;

  test("are by whoever is pushing, whatever the client says", async () => {
    const hash = await sendRun();
    await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "approved", actor: "someone-else", at: 700 }] });
    expect(await decisionOn()).toEqual({ decision: "approved", actor: "writer-login", at: 700 });
  });

  test("the latest wins, and a later one can't be later than now", async () => {
    const hash = await sendRun();
    await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: hash, decision: "rejected", at: NOW + 999 }] });
    expect(await decisionOn()).toEqual({ decision: "rejected", actor: "writer-login", at: NOW });
    await approve(hash, NOW + 1);
    expect((await decisionOn()).decision).toBe("rejected");
  });

  test("refuses what isn't a decision", async () => {
    expect((await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: "nope", decision: "approved", at: 1 }] })).status).toBe(400);
    expect((await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: UNKNOWN_HASH, decision: "maybe", at: 1 }] })).status).toBe(400);
  });
});

describe("goldens", () => {
  test("a person's approval, and then CI can make them, with nothing to remove", async () => {
    const hash = await sendRun();
    await approve(hash);
    expect(await (await goldens({ runId: RUN, baselineSha: null, removed: [] }, "ci")).json()).toEqual({ outcome: "accepted", acceptedRunId: RUN, refusal: null });
    expect(await cloud.snapshots.acceptedRunAt(SHA, ENV)).toBe(RUN);
  });

  test("are refused for what nobody approved, and leave the run", async () => {
    await sendRun();
    expect(await (await goldens({ runId: RUN, baselineSha: null, removed: [] }, "ci")).json()).toMatchObject({ outcome: "refused", refusal: { code: "not-approved" } });
    expect(await cloud.snapshots.acceptedRunAt(SHA, ENV)).toBeNull();
    expect(await cloud.snapshots.getRun(RUN)).not.toBeNull();
  });

  test("the same run again is fine", async () => {
    await approve(await sendRun());
    await goldens({ runId: RUN, baselineSha: null, removed: [] });
    expect(await (await goldens({ runId: RUN, baselineSha: null, removed: [] })).json()).toEqual({ outcome: "already", acceptedRunId: RUN, refusal: null });
  });

  test("a different run never replaces them", async () => {
    await approve(await sendRun());
    await goldens({ runId: RUN, baselineSha: null, removed: [] });
    await approve(await sendRun(OTHER_RUN, GREEN));
    expect(await (await goldens({ runId: OTHER_RUN, baselineSha: null, removed: [] })).json()).toMatchObject({ outcome: "conflict", acceptedRunId: RUN });
    expect(await cloud.snapshots.acceptedRunAt(SHA, ENV)).toBe(RUN);
  });

  describe("that remove something", () => {
    beforeEach(async () => {
      const { hash: a } = await putImage(RED);
      const { hash: b } = await putImage(BLUE);
      await send("PUT", `/runs/${RUN}`, "writer", runFacts());
      await send("POST", `/runs/${RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: a }, { story: "b", imageHash: b }] });
      await send("POST", `/runs/${RUN}/finish`, "writer", { count: 2, finishedAt: 600 });
      await send("POST", "/decisions", "writer", { environment: ENV, decisions: [{ story: "a", imageHash: a, decision: "approved", at: 700 }, { story: "b", imageHash: b, decision: "approved", at: 700 }] });
      await goldens({ runId: RUN, baselineSha: null, removed: [] });
      await send("PUT", `/runs/${OTHER_RUN}`, "writer", runFacts({ gitSha: OTHER_SHA, baselineSha: SHA }));
      await send("POST", `/runs/${OTHER_RUN}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: a }] });
      await send("POST", `/runs/${OTHER_RUN}/finish`, "writer", { count: 1, finishedAt: 800 });
    });

    test("need someone who may decide", async () => {
      expect((await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: ["b"] }, "ci")).status).toBe(403);
    });

    test("are refused if nothing was named, whoever asks", async () => {
      expect(await (await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: [] }, "ci")).json()).toMatchObject({ outcome: "refused", refusal: { code: "wrong-removed" } });
    });

    test("are refused for naming something else", async () => {
      expect(await (await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: ["c"] })).json()).toMatchObject({ outcome: "refused", refusal: { code: "wrong-removed" } });
    });

    test("go through for naming just what they remove", async () => {
      expect(await (await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: ["b"] })).json()).toMatchObject({ outcome: "accepted" });
    });
  });

  test("whose baseline isn't here are refused, saying so", async () => {
    const hash = await sendRun(RUN, RED, { baselineSha: OTHER_SHA });
    await approve(hash);
    expect(await (await goldens({ runId: RUN, baselineSha: OTHER_SHA, removed: [] })).json()).toMatchObject({ outcome: "refused", refusal: { code: "no-goldens" } });
  });

  test("hold a run to whichever goldens the sender names, since CI records no baseline", async () => {
    await approve(await sendRun());
    await goldens({ runId: RUN, baselineSha: null, removed: [] });
    // The same image, at another commit, with no approval or recorded baseline of its own.
    await sendRun(OTHER_RUN, RED, { gitSha: OTHER_SHA });
    await cloud.snapshots.mergeDecisions(ENV, []);
    expect(await (await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: [] }, "ci")).json()).toMatchObject({ outcome: "accepted" });
  });

  test("of a run from nowhere are a 404", async () => {
    expect((await goldens({ runId: OTHER_RUN, baselineSha: SHA, removed: [] })).status).toBe(404);
  });

  test("CI can find which commits have them, and no more", async () => {
    await approve(await sendRun());
    await goldens({ runId: RUN, baselineSha: null, removed: [] });
    expect(await (await send("POST", "/goldens/first", "ci", { shas: [OTHER_SHA, SHA], environment: ENV })).json()).toEqual({ sha: SHA });
    expect(await (await send("GET", `/goldens?sha=${SHA}&environment=${ENV}`, "ci")).json()).toEqual({ runId: RUN });
    expect((await send("GET", `/runs/${RUN}`, "ci")).status).toBe(403);
  });
});
