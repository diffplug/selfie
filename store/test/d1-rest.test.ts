import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { D1RestAdapter, D1RestError, type D1RestConfig } from "../src/adapters/d1-rest.ts";
import {
  imageInsertStatement,
  initStoreSchema,
  Sql,
  Store,
  type SqlRow,
  type SqlStatement,
} from "../src/core/index.ts";
import { hashOf } from "./support/sql-params.ts";
import { createTempStore } from "./support/temp-store.ts";

const TOKEN = "test-token-abc123";

type Step = Response | Error;

const ok = (...results: SqlRow[][]): Response =>
  Response.json({
    result: results.map((rows) => ({ results: rows, success: true, meta: {} })),
    errors: [],
    messages: [],
    success: true,
  });

// The shape real D1 returned for a SQL error.
const d1Error = (message: string, status = 400): Response =>
  Response.json(
    { messages: [], result: [], success: false, errors: [{ code: 7500, message }] },
    { status },
  );

const tooMany = (retryAfter?: string): Response =>
  Response.json(
    { success: false, errors: [{ code: 971, message: "Too many requests" }], result: null },
    { status: 429, ...(retryAfter === undefined ? {} : { headers: { "Retry-After": retryAfter } }) },
  );

/** An adapter whose requests get `steps` in order, recording what it sends and waits. */
function harness(steps: Step[], config: Partial<D1RestConfig> = {}) {
  const requests: { url: string; init: RequestInit }[] = [];
  const delays: number[] = [];
  const adapter = new D1RestAdapter({
    accountId: "account-1",
    databaseId: "database-1",
    token: TOKEN,
    fetch: async (input, init) => {
      requests.push({ url: String(input), init: init! });
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error("More requests than the test expected");
      if (step instanceof Error) throw step;
      return step;
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    ...config,
  });
  const bodyOf = (index: number) => JSON.parse(String(requests[index]!.init.body)) as unknown;
  return { adapter, requests, delays, bodyOf };
}

const rejection = (promise: Promise<unknown>): Promise<D1RestError> =>
  promise.then(
    () => {
      throw new Error("Expected a rejection");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(D1RestError);
      return error as D1RestError;
    },
  );

const WRITE: SqlStatement = { sql: "INSERT INTO t VALUES (1)" };
const SAFE: SqlStatement = { sql: "SELECT 1", idempotent: true };

describe("D1RestAdapter requests", () => {
  it("sends a whole batch as one authorized request to the database's query endpoint", async () => {
    const { adapter, requests, bodyOf } = harness([ok([], [{ a: 1 }])]);
    const results = await adapter.execute([
      { sql: "INSERT INTO t VALUES (?1, ?2)", params: ["x", 2] },
      { sql: "SELECT a FROM t" },
    ]);
    expect(results).toEqual([[], [{ a: 1 }]]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/d1/database/database-1/query",
    );
    expect(requests[0]!.init.method).toBe("POST");
    expect(new Headers(requests[0]!.init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(0)).toEqual({
      batch: [
        { sql: "INSERT INTO t VALUES (?1, ?2)", params: ["x", 2] },
        { sql: "SELECT a FROM t", params: [] },
      ],
    });
  });

  it("sends no request for an empty batch, which D1 refuses", async () => {
    const { adapter, requests } = harness([]);
    expect(await adapter.execute([])).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("treats a result with no rows array as no rows", async () => {
    const { adapter } = harness([
      Response.json({ result: [{ success: true }], errors: [], success: true }),
    ]);
    expect(await adapter.execute([WRITE])).toEqual([[]]);
  });

  it("bounds each attempt with a timeout", async () => {
    const { adapter, requests } = harness([ok([])]);
    await adapter.execute([WRITE]);
    expect(requests[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls a bare fetch, as a Worker's fetch requires", async () => {
    let receiver: unknown = "unset";
    const adapter = new D1RestAdapter({
      accountId: "a",
      databaseId: "d",
      token: TOKEN,
      fetch: async function (this: unknown) {
        receiver = this;
        return ok([]);
      },
    });
    await adapter.execute([WRITE]);
    expect(receiver).toBeUndefined();
  });
});

describe("D1RestAdapter on HTTP 429", () => {
  it("resends a statement that is not idempotent, since a 429 means it never ran", async () => {
    const { adapter, requests } = harness([tooMany(), ok([{ a: 1 }])]);
    expect(await adapter.execute([WRITE])).toEqual([[{ a: 1 }]]);
    expect(requests).toHaveLength(2);
  });

  it("doubles a jittered delay between retries, and stops at the attempt limit", async () => {
    const { adapter, requests, delays } = harness([tooMany(), tooMany(), tooMany(), tooMany()]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(requests).toHaveLength(4);
    expect(delays).toHaveLength(3);
    [1000, 2000, 4000].forEach((ceiling, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delays[i]).toBeLessThanOrEqual(ceiling);
    });
    expect(error.status).toBe(429);
    expect(error.attempts).toBe(4);
    expect(error.outcomeUnknown).toBe(false);
    expect(error.message).toContain("Too many requests");
  });

  it("caps the delay", async () => {
    const { adapter, delays } = harness([tooMany(), tooMany(), ok([])], {
      retry: { baseDelayMs: 10_000, maxDelayMs: 12_000 },
    });
    await adapter.execute([WRITE]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(12_000);
  });

  it("waits as long as Retry-After asks", async () => {
    const { adapter, delays } = harness([tooMany("7"), ok([])]);
    await adapter.execute([WRITE]);
    expect(delays[0]).toBeGreaterThanOrEqual(7_000);
    expect(delays[0]).toBeLessThanOrEqual(8_000);
  });

  it("fails at once when Retry-After is the 5 minute block, reporting the wait", async () => {
    const { adapter, requests, delays } = harness([tooMany("300")]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(requests).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(error.retryAfterMs).toBe(300_000);
    expect(error.message).toContain("300s");
  });

  it("falls back to its own delay on a Retry-After that is not seconds", async () => {
    const { adapter, delays } = harness([tooMany("soon"), ok([])]);
    await adapter.execute([WRITE]);
    expect(delays[0]).toBeLessThanOrEqual(1_000);
  });
});

describe("D1RestAdapter when the outcome is unknown", () => {
  const unknowns: [string, () => Step][] = [
    ["a network failure", () => new TypeError("fetch failed")],
    ["a timeout", () => new DOMException("The operation timed out", "TimeoutError")],
    ["a 5xx", () => new Response("<html>Bad gateway</html>", { status: 502 })],
    ["a 5xx from D1", () => d1Error("Internal error", 500)],
    ["an unreadable 200", () => new Response("not json")],
    ["a 200 with no results", () => Response.json({ success: true })],
    // The documented retryable messages, as the status they arrive with isn't documented.
    ["D1's transient error", () => d1Error("D1_ERROR: Network connection lost.")],
  ];

  it.each(unknowns)("does not resend after %s if a statement isn't idempotent", async (_, step) => {
    const { adapter, requests } = harness([step()]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(requests).toHaveLength(1);
    expect(error.outcomeUnknown).toBe(true);
    expect(error.message).toContain("may have taken effect");
  });

  it.each(unknowns)("resends after %s if every statement is idempotent", async (_, step) => {
    const { adapter, requests, delays } = harness([step(), ok([{ a: 1 }])]);
    expect(await adapter.execute([SAFE])).toEqual([[{ a: 1 }]]);
    expect(requests).toHaveLength(2);
    expect(delays).toHaveLength(1);
  });

  it("does not resend a batch with one statement that isn't idempotent", async () => {
    const { adapter, requests } = harness([new TypeError("fetch failed")]);
    await rejection(adapter.execute([SAFE, WRITE]));
    expect(requests).toHaveLength(1);
  });

  it("gives up on idempotent statements at the attempt limit", async () => {
    const failure = () => new TypeError("fetch failed");
    const { adapter, requests } = harness([failure(), failure(), failure(), failure()]);
    const error = await rejection(adapter.execute([SAFE]));
    expect(requests).toHaveLength(4);
    expect(error.attempts).toBe(4);
    expect(error.outcomeUnknown).toBe(true);
  });

  it("includes the underlying network cause", async () => {
    const failure = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    const { adapter } = harness([failure]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(error.message).toContain("ECONNREFUSED");
    expect(error.status).toBeUndefined();
  });
});

describe("D1RestAdapter when D1 answers with a failure", () => {
  // Both shapes as real D1 returned them.
  it("fails at once on a SQL error, even if idempotent, with D1's message", async () => {
    const { adapter, requests } = harness([d1Error("no such table: t: SQLITE_ERROR")]);
    const error = await rejection(adapter.execute([SAFE]));
    expect(requests).toHaveLength(1);
    expect(error.status).toBe(400);
    expect(error.codes).toEqual([7500]);
    expect(error.outcomeUnknown).toBe(false);
    expect(error.message).toContain("[7500] no such table: t: SQLITE_ERROR");
  });

  it("fails at once on a bad token, with Cloudflare's message", async () => {
    const { adapter, requests } = harness([
      Response.json(
        { result: null, success: false, errors: [{ code: 10000, message: "Authentication error" }] },
        { status: 401 },
      ),
    ]);
    const error = await rejection(adapter.execute([SAFE]));
    expect(requests).toHaveLength(1);
    expect(error.status).toBe(401);
    expect(error.message).toContain("Authentication error");
  });

  it("refuses a result count that doesn't match the statements", async () => {
    const { adapter } = harness([ok([], [])]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(error.message).toContain("Sent 1 statements but got 2 results");
  });

  it("refuses a statement D1 marks as failed", async () => {
    const { adapter } = harness([
      Response.json({ result: [{ success: false, results: [] }], errors: [], success: true }),
    ]);
    await rejection(adapter.execute([WRITE]));
  });
});

describe("D1RestAdapter and the token", () => {
  const expectClean = (error: D1RestError) => {
    for (const text of [error.message, error.stack ?? "", inspect(error), JSON.stringify(error)]) {
      // includes(), not toContain(), so a failure here can't print a real-looking token.
      expect(text.includes(TOKEN)).toBe(false);
    }
  };

  it("keeps it out of an error when fetch quotes it", async () => {
    const { adapter } = harness([new TypeError(`Invalid header value: Bearer ${TOKEN}`)]);
    const error = await rejection(adapter.execute([WRITE]));
    expect(error.message).toContain("[redacted]");
    expectClean(error);
  });

  it("keeps it out of an error when the network cause quotes it", async () => {
    const failure = new TypeError("fetch failed", { cause: new Error(`Bearer ${TOKEN}`) });
    const { adapter } = harness([failure]);
    expectClean(await rejection(adapter.execute([WRITE])));
  });

  it("keeps it out of an error when the response quotes it", async () => {
    const { adapter } = harness([d1Error(`Bad value ${TOKEN}`)]);
    expectClean(await rejection(adapter.execute([WRITE])));
  });

  it("keeps it out of an error when a non-JSON response quotes it", async () => {
    const { adapter } = harness([new Response(`Bad value ${TOKEN}`, { status: 403 })]);
    expectClean(await rejection(adapter.execute([WRITE])));
  });

  // A stray character from an env file would otherwise reach the platform's header
  // check, whose error quotes the header value in a form redaction can't match.
  it.each([`${TOKEN}\n`, `${TOKEN} more`, `${TOKEN}\u00e9`])(
    "refuses a token that isn't a valid header value, without quoting it: %#",
    (token) => {
      const config = { accountId: "a", databaseId: "d", token };
      expect(() => new D1RestAdapter(config)).toThrow(TypeError);
      try {
        new D1RestAdapter(config);
      } catch (error) {
        expect(String(error).includes(TOKEN)).toBe(false);
      }
    },
  );

  it("keeps it out of a logged or serialized adapter", () => {
    const { adapter } = harness([]);
    expect(inspect(adapter, { showHidden: true, depth: 5 }).includes(TOKEN)).toBe(false);
    expect(JSON.stringify(adapter).includes(TOKEN)).toBe(false);
  });

  it.each(["token", "accountId", "databaseId"] as const)("requires %s", (field) => {
    const config = { accountId: "a", databaseId: "d", token: "t", [field]: "" };
    expect(() => new D1RestAdapter(config)).toThrow(TypeError);
  });
});

describe("D1RestAdapter replay against a real SQL engine", () => {
  let temp: Awaited<ReturnType<typeof createTempStore>>;

  afterEach(async () => {
    await temp.destroy();
  });

  /**
   * An adapter over local SQLite that really runs each request, then loses the
   * response to those `shouldLose` picks, as a connection dropped after a commit would.
   */
  async function losingResponses(shouldLose: (request: number) => boolean) {
    temp = await createTempStore();
    const engine = temp.connect();
    const sent: SqlStatement[] = [];
    let requests = 0;
    const adapter = new D1RestAdapter({
      accountId: "a",
      databaseId: "d",
      token: TOKEN,
      sleep: async () => {},
      fetch: async (_, init) => {
        const { batch } = JSON.parse(String(init?.body)) as { batch: SqlStatement[] };
        sent.push(...batch);
        const rows = await engine.batch(batch);
        if (shouldLose(requests++)) throw new TypeError("fetch failed");
        return ok(...rows);
      },
    });
    return { sql: new Sql(adapter), sent, requests: () => requests };
  }

  it("keeps one key and spends no negative key when an image insert is replayed", async () => {
    const { sql, requests } = await losingResponses((request) => request < 2);
    expect(await sql.run(imageInsertStatement(hashOf(1), 500))).toEqual([{ key: 500 }]);
    expect(requests()).toBe(3);
    expect(await sql.run(imageInsertStatement(hashOf(2), 500))).toEqual([{ key: -1 }]);
    expect(await sql.run(imageInsertStatement(hashOf(3), 500))).toEqual([{ key: -2 }]);
  });

  it("marks everything the store sends as idempotent, so a lost response never fails it", async () => {
    // Every first try of each statement loses its response.
    const { sql, sent } = await losingResponses((request) => request % 2 === 0);
    await initStoreSchema(sql);
    const store = new Store({ sql, blob: temp.blob });
    const pixels = new Uint8Array([1, 2, 3]);
    const { hash: imageHash, key } = await store.putImage({ width: 1, height: 1, pixels });
    expect(await store.lookupKey(imageHash)).toBe(key);
    expect(sent).toHaveLength(6);
  });
});
