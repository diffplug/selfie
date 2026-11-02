// The D1 REST adapter inside workerd, through the runtime's real `fetch`, against real
// D1, and then the production combination: the whole `Store` over it and R2. Opt-in
// through `pnpm test:d1:workerd`, since it needs credentials and spends the account's
// shared API rate limit. A run reports the requests it sent, 17 as written, and stops
// at its budget. Only one run of any real-D1 suite at a time: all of them use the same database.

import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D1RestAdapter, D1RestError, type D1RestConfig } from "selfie-store/adapters/d1-rest";
import { R2BlobStorage } from "selfie-store/adapters/r2";
import { Blobs, encodePam, initStoreSchema, Sql, Store, toHex, type RawImage } from "../../src/core/index.ts";
import { collidingHash } from "../support/colliding-hash.ts";

const { D1_ACCOUNT_ID: accountId, D1_DATABASE_ID: databaseId, D1_TOKEN: token } = env;

// Well above a healthy run, and far below the shared limit of 1,200 per 5 minutes.
const REQUEST_BUDGET = 30;

// Only ever compared, never handed to an assertion, so a failure can't print it.
const leaksToken = (text: string) => text.includes(token!);

describe.skipIf(token === undefined)("real D1 inside workerd (opt-in: pnpm test:d1:workerd)", () => {
  let requests = 0;
  const cfRays: boolean[] = [];

  // Calls the runtime's own `fetch`, and stops a run that has gone wrong.
  const countedFetch: typeof fetch = async (input, init) => {
    if (requests >= REQUEST_BUDGET) throw new Error(`Stopped at ${REQUEST_BUDGET} requests`);
    requests++;
    const response = await fetch(input, init);
    cfRays.push(response.headers.has("cf-ray"));
    return response;
  };

  const connect = (overrides: Partial<D1RestConfig> = {}) =>
    new Sql(
      new D1RestAdapter({
        accountId: accountId!,
        databaseId: databaseId!,
        token: token!,
        fetch: countedFetch,
        // A real 429 means the account is over its limit, so fail rather than wait.
        retry: { maxAttempts: 2, baseDelayMs: 200 },
        ...overrides,
      }),
    );

  beforeAll(async () => {
    // A crashed run may have left these behind.
    await connect().batch([
      { sql: "DROP TABLE IF EXISTS images" },
      { sql: "DROP TABLE IF EXISTS workerd_probe" },
    ]);
  });

  afterAll(async () => {
    const [, , left] = await connect().batch([
      { sql: "DROP TABLE IF EXISTS images" },
      { sql: "DROP TABLE IF EXISTS workerd_probe" },
      { sql: "SELECT name FROM sqlite_master WHERE name IN ('images', 'workerd_probe')" },
    ]);
    console.log(`Real D1 inside workerd: ${requests} API requests.`);
    expect(left).toEqual([]);
    expect(cfRays).not.toContain(false);
  });

  describe("D1RestAdapter", () => {
    it("reaches D1 through the runtime's fetch when given none", async () => {
      expect(navigator.userAgent).toBe("Cloudflare-Workers");
      // Bare, not counted, to exercise the default. One attempt makes it one request.
      const sql = connect({ fetch: undefined, retry: { maxAttempts: 1 } });
      requests++;
      expect(await sql.run({ sql: "SELECT 1 AS one" })).toEqual([{ one: 1 }]);
    });

    it("runs a batch in one request, with parameters and rows intact", async () => {
      const before = requests;
      const [, , rows] = await connect().batch([
        { sql: "CREATE TABLE workerd_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)" },
        {
          sql: "INSERT INTO workerd_probe (id, label) VALUES (CAST(?1 AS INTEGER), ?2), (CAST(?3 AS INTEGER), ?4)",
          params: [7, "seven", "8", "ocho ☃"],
        },
        { sql: "SELECT id, label FROM workerd_probe ORDER BY id" },
      ]);
      expect(rows).toEqual([
        { id: 7, label: "seven" },
        { id: 8, label: "ocho ☃" },
      ]);
      expect(requests - before).toBe(1);
    });

    it("rejects with D1's own message and no token", async () => {
      const error = await connect()
        .run({ sql: "SELEKT 1" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(D1RestError);
      const { message, codes, status, attempts } = error as D1RestError;
      expect(message).toContain("syntax error");
      expect({ codes, status, attempts }).toEqual({ codes: [7500], status: 400, attempts: 1 });
      expect(leaksToken(message)).toBe(false);
      expect(leaksToken(JSON.stringify(error))).toBe(false);
      expect(leaksToken(String((error as Error).stack))).toBe(false);
    });

    it("times out a request with AbortSignal.timeout, as an unknown outcome", async () => {
      const error = await connect({ requestTimeoutMs: 1, retry: { maxAttempts: 1 } })
        .run({ sql: "SELECT 1" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(D1RestError);
      expect((error as D1RestError).outcomeUnknown).toBe(true);
      expect((error as D1RestError).status).toBeUndefined();
      expect(leaksToken((error as D1RestError).message)).toBe(false);
    });
  });

  describe("Store over R2 and D1 REST", () => {
    /** A 1×1 image whose red channel identifies it, as `collidingHash` expects. */
    const image = (id: number): RawImage => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array([id, 0, 0, 255]),
    });
    const TRUNCATED = 500;
    const project = `workerd-${crypto.randomUUID()}`;
    const prefix = `projects/${project}/`;
    const blob = new Blobs(new R2BlobStorage({ bucket: env.BLOBS, project }));
    const a = image(1);
    const b = image(2);
    const hash = collidingHash({ 1: TRUNCATED, 2: TRUNCATED });

    let store: Store;

    beforeAll(async () => {
      const sql = connect();
      await initStoreSchema(sql);
      store = new Store({ sql, blob, hash });
    });

    afterAll(async () => {
      const { objects } = await env.BLOBS.list({ prefix });
      await env.BLOBS.delete(objects.map((object) => object.key));
    });

    it("stores a colliding pair under separate keys and separate objects", async () => {
      const first = await store.putImage(a);
      const second = await store.putImage(b);
      expect(first.key).toBe(TRUNCATED);
      expect(second.key).toBe(-1);
      expect(first.hash).not.toBe(second.hash);

      // Inserting again returns what the first insert assigned, negative key included.
      expect(await store.putImage(a)).toEqual(first);
      expect(await store.putImage(b)).toEqual(second);

      expect(await store.lookupKey(first.hash)).toBe(TRUNCATED);
      expect(await store.lookupKey(second.hash)).toBe(-1);
      expect(await store.getImage(first.hash)).toEqual(encodePam(a));
      expect(await store.getImage(second.hash)).toEqual(encodePam(b));

      const { objects } = await env.BLOBS.list({ prefix });
      expect(objects.map((object) => object.key).sort()).toEqual(
        [first.hash, second.hash].map((imageHash) => `${prefix}images/${imageHash}`).sort(),
      );
    });

    it("reports an unstored image as absent, and an orphan blob as not stored", async () => {
      const orphan = toHex(await hash(encodePam(image(3))));
      await blob.put(`images/${orphan}`, encodePam(image(3)));
      expect(await store.lookupKey(orphan)).toBeNull();
      expect(await store.getImage(orphan)).toBeNull();
    });
  });
});
