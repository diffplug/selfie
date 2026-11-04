// The sync routes inside workerd, on its local D1 and R2, as a deployed Worker would run them, but for
// the GitHub seam and D1's REST API. Nothing crosses to Node, and no account is involved. These run in
// order, each on what the last left. See docs/specs/sync.md.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { Blobs, initStoreSchema, ReceivingStore, RenderBatches, Sql, type SqlAdapter, type SqlRow } from "selfie-store";
import { R2BlobStorage, type R2BucketLike } from "selfie-store/adapters/r2";
import { createSyncApi, type SyncAccess } from "../../src/server/sync.ts";

const ON = { batchId: "00000000-0000-4000-8000-000000000001", gitSha: "e".repeat(40) };

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

const batchFacts = (gitSha: string) => ({ gitSha, environment: ENV, startedAt: 500, dirty: false, storyFilter: null, reusedFromBatch: null, scale: 1, viewport: { width: 1200, height: 900 } });

beforeAll(async () => {
  const sql = new Sql(d1Binding(env.DB));
  await initStoreSchema(sql);
  const store = new ReceivingStore({ sql, blob: new Blobs(new R2BlobStorage({ bucket: env.BLOBS as R2BucketLike, project: "42" })) });
  const batches = new RenderBatches({ sql });
  app = createSyncApi({
    open: async (_project, token) => {
      const access = token === null ? undefined : ACCESS[token];
      return access === undefined ? null : { access, batches, store, hasCommit: async () => true };
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

  it("takes a batch, and the image it lacks", async () => {
    expect(await sendJson("PUT", `/batches/${FIRST}`, "writer", batchFacts(SHA))).toEqual({ status: "recording" });
    expect(await sendJson("POST", "/images/missing", "writer", { hashes: [hash, UNKNOWN_HASH] })).toEqual({ missing: [hash, UNKNOWN_HASH] });
    expect((await send("PUT", `/images/${hash}`, "writer", png)).status).toBe(200);
    expect(await sendJson("POST", "/images/missing", "writer", { hashes: [hash] })).toEqual({ missing: [] });
    expect((await send("POST", `/batches/${FIRST}/renders`, "writer", { renders: [{ story: "a", imageHash: hash }] })).status).toBe(200);
    expect(await sendJson("POST", `/batches/${FIRST}/finish`, "writer", { count: 1, finishedAt: 600 })).toEqual({ status: "complete" });
  });

  it("merges decisions by latest wins, in any order, on D1's own engine", async () => {
    const decisions = (decision: string, at: number) => ({ environment: ENV, decisions: [{ story: "a", imageHash: hash, decision, at, gitSha: SHA, batchId: FIRST }] });
    expect((await send("POST", "/decisions", "writer", decisions("rejected", 700))).status).toBe(200);
    expect((await send("POST", "/decisions", "writer", decisions("approved", 800))).status).toBe(200);
    expect((await send("POST", "/decisions", "writer", decisions("rejected", 750))).status).toBe(200);
    const page = (await sendJson("GET", `/batches/${FIRST}`, "writer")) as { renders: { decision: unknown }[]; batch: unknown };
    expect(page.renders[0]!.decision).toEqual({ decision: "approved", actor: "writer-login", at: 800, gitSha: SHA, batchId: FIRST });
    expect(page.batch).toMatchObject({ startedAt: 500, finishedAt: 600 });
  });

  it("makes goldens, and then CI can make the next ones from a person's approval", async () => {
    expect(await sendJson("POST", "/goldens", "writer", { batchId: FIRST, baselineSha: null, removed: [] })).toEqual({ outcome: "accepted", acceptedBatchId: FIRST, refusal: null });
    await send("PUT", `/batches/${SECOND}`, "ci", batchFacts(NEXT_SHA));
    await send("POST", `/batches/${SECOND}/renders`, "ci", { renders: [{ story: "a", imageHash: hash }] });
    await send("POST", `/batches/${SECOND}/finish`, "ci", { count: 1, finishedAt: 900 });
    expect(await sendJson("POST", "/goldens/first", "ci", { shas: [NEXT_SHA, SHA], environment: ENV })).toEqual({ sha: SHA });
    expect(await sendJson("POST", "/goldens", "ci", { batchId: SECOND, baselineSha: SHA, removed: [] })).toMatchObject({ outcome: "accepted" });
  });

  it("serves an image's bytes back, from R2", async () => {
    const response = await send("GET", `/images/${hash}`, "writer");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("says only what an image's type is, so nothing runs what it holds", async () => {
    const { headers } = await send("GET", `/images/${hash}`, "writer");
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  // What a real client sends, since a local store keeps WebP. A Worker has no codec, and needs none.
  it("takes a real WebP under the hash it's sent with, as those bytes", async () => {
    const webp = fromBase64("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQiirUo/+BiOh/AAA=");
    const webpHash = "e".repeat(64);
    expect((await send("PUT", `/images/${webpHash}`, "writer", webp)).status).toBe(200);
    const served = await send("GET", `/images/${webpHash}`, "writer");
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(webp);
  });

  it("refuses what no store keeps, by its form alone", async () => {
    const lossy = new TextEncoder().encode("RIFF\x12\0\0\0WEBPVP8 \x06\0\0\0abcdefghijklm");
    expect(await sendJson("PUT", `/images/${"d".repeat(64)}`, "writer", lossy)).toMatchObject({ error: { code: "bad-image" } });
    expect(await sendJson("PUT", `/images/${"d".repeat(64)}`, "writer", new Uint8Array([1, 2, 3]))).toMatchObject({ error: { code: "bad-image" } });
  });
});
