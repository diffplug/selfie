// The D1 REST adapter inside workerd, through the runtime's real `fetch`, against real
// D1, and then the production combination: the whole `Store` over it and R2. Opt-in
// through `pnpm test:d1:workerd`, since it needs credentials and spends the account's
// shared API rate limit. A batch reports the requests it sent and stops
// at its budget. Only one batch of any real-D1 suite at a time: all of them use the same database.

import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D1RestError, type D1RestConfig } from "selfie-store/adapters/d1-rest";
import { R2BlobStorage } from "selfie-store/adapters/r2";
import { Blobs, encodePam, initStoreSchema, ReceivingStore, Sql, toHex } from "../../src/core/index.ts";
import { collidingHash, image } from "../support/colliding-hash.ts";
import { createD1Harness, type D1Harness } from "../support/d1-harness.ts";
import { pngOf } from "../support/png-builder.ts";
import { emptyBucket, objectKeys } from "./bucket.ts";

const { D1_ACCOUNT_ID: accountId, D1_DATABASE_ID: databaseId, D1_TOKEN: token } = env;

// Well above a healthy batch, and far below the shared limit of 1,200 per 5 minutes.
const REQUEST_BUDGET = 30;

describe.skipIf(token === undefined)("real D1 inside workerd (opt-in: pnpm test:d1:workerd)", () => {
  let harness: D1Harness;
  const cfRays: boolean[] = [];

  const connect = (overrides: Partial<D1RestConfig> = {}) =>
    new Sql(
      harness.connect(
        (next) => async (input, init) => {
          const response = await next(input, init);
          cfRays.push(response.headers.has("cf-ray"));
          return response;
        },
        overrides,
      ),
    );

  beforeAll(async () => {
    harness = createD1Harness({
      accountId: accountId!,
      databaseId: databaseId!,
      token: token!,
      budget: REQUEST_BUDGET,
    });
    // A crashed batch may have left tables behind.
    await harness.sweep();
  });

  afterAll(async () => {
    await harness.sweep();
    const left = await connect().run({
      sql: "SELECT name FROM sqlite_master WHERE name IN ('images', 'workerd_probe')",
    });
    console.log(`Real D1 inside workerd: ${harness.requests} API requests.`);
    expect(left).toEqual([]);
    expect(cfRays).not.toContain(false);
  });

  describe("D1RestAdapter", () => {
    it("reaches D1 through the runtime's fetch when given none", async () => {
      expect(navigator.userAgent).toBe("Cloudflare-Workers");
      // Bare, not counted, to exercise the default. One attempt makes it one request.
      const sql = connect({ fetch: undefined, retry: { maxAttempts: 1 } });
      expect(await sql.run({ sql: "SELECT 1 AS one" })).toEqual([{ one: 1 }]);
    });

    it("runs a batch in one request, with parameters and rows intact", async () => {
      const before = harness.requests;
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
      expect(harness.requests - before).toBe(1);
    });

    it("rejects with D1's own message and no token", async () => {
      const error = await connect()
        .run({ sql: "SELEKT 1" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(D1RestError);
      const { message, codes, status, attempts } = error as D1RestError;
      expect(message).toContain("syntax error");
      expect({ codes, status, attempts }).toEqual({ codes: [7500], status: 400, attempts: 1 });
      expect(harness.leaksToken(message)).toBe(false);
      expect(harness.leaksToken(JSON.stringify(error))).toBe(false);
      expect(harness.leaksToken(String((error as Error).stack))).toBe(false);
    });

    it("times out a request with AbortSignal.timeout, as an unknown outcome", async () => {
      const error = await connect({ requestTimeoutMs: 1, retry: { maxAttempts: 1 } })
        .run({ sql: "SELECT 1" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(D1RestError);
      expect((error as D1RestError).outcomeUnknown).toBe(true);
      expect((error as D1RestError).status).toBeUndefined();
      expect(harness.leaksToken((error as D1RestError).message)).toBe(false);
    });
  });

  describe("Store over R2 and D1 REST", () => {
    const TRUNCATED = 500;
    const project = `workerd-${crypto.randomUUID()}`;
    const prefix = `projects/${project}/`;
    const blob = new Blobs(new R2BlobStorage({ bucket: env.BLOBS, project }));
    // Two hashes sharing their first 53 bits, since this store takes a hash as it's sent.
    const collidingHashOf = async (id: number) => toHex(await collidingHash({ [id]: TRUNCATED })(encodePam(image(id))));
    let firstHash: string;
    let secondHash: string;
    const a = pngOf(image(1));
    const b = pngOf(image(2));

    let store: ReceivingStore;

    beforeAll(async () => {
      const sql = connect();
      await initStoreSchema(sql);
      store = new ReceivingStore({ sql, blob });
      firstHash = await collidingHashOf(1);
      secondHash = await collidingHashOf(2);
    });

    afterAll(async () => {
      await emptyBucket(prefix);
    });

    it("stores a colliding pair under separate keys and separate objects", async () => {
      const first = await store.receiveImage(a, firstHash);
      const second = await store.receiveImage(b, secondHash);
      expect(first.key).toBe(TRUNCATED);
      expect(second.key).toBe(-1);
      expect(first.hash).not.toBe(second.hash);

      // Inserting again returns what the first insert assigned, negative key included.
      expect(await store.receiveImage(a, firstHash)).toEqual(first);
      expect(await store.receiveImage(b, secondHash)).toEqual(second);

      expect(await store.lookupKey(first.hash)).toBe(TRUNCATED);
      expect(await store.lookupKey(second.hash)).toBe(-1);
      expect(await store.getImage(first.hash)).toEqual(a);
      expect(await store.getImage(second.hash)).toEqual(b);

      expect((await objectKeys(prefix)).sort()).toEqual(
        [first.hash, second.hash].map((imageHash) => `${prefix}images/${imageHash}`).sort(),
      );
    });

    it("asks about a full group of images with one 100 parameter lookup", async () => {
      const real = new ReceivingStore({ sql: connect(), blob });
      const hashes = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(64, "f"));
      const before = harness.requests;
      expect(await real.missingImages(hashes)).toEqual(hashes);
      expect(harness.requests - before).toBe(1);
    });

    it("reports an unstored image as absent, and an orphan blob as not stored", async () => {
      const orphan = "3".repeat(64);
      await blob.put(`images/${orphan}`, pngOf(image(3)));
      expect(await store.lookupKey(orphan)).toBeNull();
      expect(await store.getImage(orphan)).toBeNull();
    });
  });
});
