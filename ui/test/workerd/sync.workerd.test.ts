// The sync routes inside workerd, on its local D1 and R2, as a deployed Worker would run them, but for
// the GitHub seam and D1's REST API. Nothing crosses to Node, and no account is involved. These run in
// order, each on what the last left. See docs/specs/sync.md.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { Blobs, initStoreSchema, Snapshots, Sql, Store, type SqlAdapter, type SqlRow } from "selfie-store";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { createSyncApi, type SyncAccess } from "../../src/server/sync.ts";

const SHA = "a".repeat(40);
const NEXT_SHA = "b".repeat(40);
const ENV = "container-linux-arm64-0123456789abcdef";
const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** A 4 by 4 image, and the hash that names it in every store. */
const png = fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4XmM4IScHRwzEcQCxYxBBF7FZ1QAAAABJRU5ErkJggg==");
const hash = "6fc35503986a1b85896ca807408798a0bbbf1ad557fd91ee6d19f5ba0469e636";
const UNKNOWN_HASH = "f".repeat(64);

const ACCESS: Readonly<Record<string, SyncAccess>> = {
  writer: { view: true, upload: true, decider: "writer-login" },
  ci: { view: false, upload: true, decider: null },
};

/** `Sql` over a D1 binding, which isn't an adapter the product has yet, since it reaches D1 by REST. */
const d1Binding = (db: D1Database): SqlAdapter => ({
  execute: async (statements) => {
    const results = await db.batch(statements.map(({ sql, params = [] }) => db.prepare(sql).bind(...params)));
    return results.map(({ results: rows }) => rows as SqlRow[]);
  },
});

let app: ReturnType<typeof createSyncApi>;

const send = (method: string, route: string, token: string, body?: unknown) =>
  app.request(`/projects/42${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
  });

const sendJson = async (method: string, route: string, token: string, body?: unknown) => (await send(method, route, token, body)).json();

const runFacts = (gitSha: string) => ({ gitSha, environment: ENV, startedAt: 500, dirty: false, baselineSha: null, storyFilter: null, reusedFromRun: null, scale: 1 });

beforeAll(async () => {
  const sql = new Sql(d1Binding(env.DB));
  await initStoreSchema(sql);
  const store = new Store({ sql, blob: new Blobs(new R2BlobStorage({ bucket: env.BLOBS as R2BucketLike, project: "42" })) });
  const snapshots = new Snapshots({ sql });
  app = createSyncApi({
    open: async (_project, token) => {
      const access = token === null ? undefined : ACCESS[token];
      return access === undefined ? null : { access, snapshots, store, hasCommit: async () => true };
    },
    findProject: async () => "42",
  });
});

describe("the sync routes, in a Worker", () => {
  it("runs where it says it does", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
    expect(env.DB.constructor.name).toBe("D1Database");
    expect(env.BLOBS.constructor.name).toBe("R2Bucket");
  });

  it("takes a run, and the image it lacks", async () => {
    expect(await sendJson("PUT", `/runs/${FIRST}`, "writer", runFacts(SHA))).toEqual({ status: "recording" });
    expect(await sendJson("POST", "/images/missing", "writer", { hashes: [hash, UNKNOWN_HASH] })).toEqual({ missing: [hash, UNKNOWN_HASH] });
    expect((await send("PUT", `/images/${hash}`, "writer", png)).status).toBe(200);
    expect(await sendJson("POST", "/images/missing", "writer", { hashes: [hash] })).toEqual({ missing: [] });
    expect((await send("POST", `/runs/${FIRST}/snapshots`, "writer", { snapshots: [{ story: "a", imageHash: hash }] })).status).toBe(200);
    expect(await sendJson("POST", `/runs/${FIRST}/finish`, "writer", { count: 1, finishedAt: 600 })).toEqual({ status: "complete" });
  });

  it("merges decisions by latest wins, in any order, on D1's own engine", async () => {
    const decisions = (decision: string, at: number) => ({ environment: ENV, decisions: [{ story: "a", imageHash: hash, decision, at }] });
    expect((await send("POST", "/decisions", "writer", decisions("rejected", 700))).status).toBe(200);
    expect((await send("POST", "/decisions", "writer", decisions("approved", 800))).status).toBe(200);
    expect((await send("POST", "/decisions", "writer", decisions("rejected", 750))).status).toBe(200);
    const page = (await sendJson("GET", `/runs/${FIRST}`, "writer")) as { snapshots: { decision: unknown }[]; run: unknown };
    expect(page.snapshots[0]!.decision).toEqual({ decision: "approved", actor: "writer-login", at: 800 });
    expect(page.run).toMatchObject({ startedAt: 500, finishedAt: 600 });
  });

  it("makes goldens, and then CI can make the next ones from a person's approval", async () => {
    expect(await sendJson("POST", "/goldens", "writer", { runId: FIRST, baselineSha: null, removed: [] })).toEqual({ outcome: "accepted", acceptedRunId: FIRST, refusal: null });
    await send("PUT", `/runs/${SECOND}`, "ci", runFacts(NEXT_SHA));
    await send("POST", `/runs/${SECOND}/snapshots`, "ci", { snapshots: [{ story: "a", imageHash: hash }] });
    await send("POST", `/runs/${SECOND}/finish`, "ci", { count: 1, finishedAt: 900 });
    expect(await sendJson("POST", "/goldens/first", "ci", { shas: [NEXT_SHA, SHA], environment: ENV })).toEqual({ sha: SHA });
    expect(await sendJson("POST", "/goldens", "ci", { runId: SECOND, baselineSha: SHA, removed: [] })).toMatchObject({ outcome: "accepted" });
  });

  it("serves an image's bytes back, from R2", async () => {
    const response = await send("GET", `/images/${hash}`, "writer");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("refuses bytes that aren't the image they're sent as", async () => {
    expect(await sendJson("PUT", `/images/${UNKNOWN_HASH}`, "writer", png)).toMatchObject({ error: { code: "hash-mismatch" } });
  });

  // What a real client sends, since a local store keeps WebP. So until a Worker has a codec (docs/specs/store.md
  // -> A Worker reading a WebP), a real push of anything under 16,384 pixels a side stops here.
  it("refuses a real WebP, since a Worker has no codec yet", async () => {
    const webp = fromBase64("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==");
    const response = await send("PUT", `/images/${"e".repeat(64)}`, "writer", webp);
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("bad-image");
    expect(error.message.toLowerCase()).toContain("webp");
  });
});
