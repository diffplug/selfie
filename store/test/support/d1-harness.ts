import { D1RestAdapter, type D1RestConfig } from "../../src/adapters/d1-rest.ts";
import { Sql, type SqlAdapter } from "../../src/core/index.ts";

export interface D1HarnessConfig {
  readonly accountId: string;
  readonly databaseId: string;
  readonly token: string;
  /**
   * Going over Cloudflare's 1,200 requests per 5 minutes blocks all API calls for 5
   * minutes. This stops a batch that has gone wrong well before that. It doesn't protect
   * repeated runs: don't loop these suites.
   */
  readonly budget: number;
}

/** Wiring for tests against the real contract database, and a count of what they send. */
export interface D1Harness {
  /**
   * A new adapter, and so a new connection. `wrap` sits between it and the counted
   * fetch. `overrides` replace any of its config, leaving a request uncounted if they
   * replace `fetch`.
   */
  connect(wrap?: (next: typeof fetch) => typeof fetch, overrides?: Partial<D1RestConfig>): SqlAdapter;
  /** Drops every table except D1's own, leaving the database empty. */
  sweep(): Promise<void>;
  /** Runs `work`, also returning the most requests that were in flight at once during it. */
  measureOverlap<T>(work: () => Promise<T>): Promise<{ result: T; peak: number }>;
  /** Asks without exposing the token to the caller, so a failing assertion can't print it. */
  leaksToken(text: string): boolean;
  readonly requests: number;
}

export function createD1Harness({ accountId, databaseId, token, budget }: D1HarnessConfig): D1Harness {
  let requests = 0;
  let inFlight = 0;
  let peak = 0;
  let stopped: string | undefined;

  const counted: typeof fetch = async (input, init) => {
    if (stopped !== undefined) throw new Error(stopped);
    if (requests >= budget) {
      stopped = `Stopped real-D1 run at its budget of ${budget} requests`;
      throw new Error(stopped);
    }
    requests++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      const response = await fetch(input, init);
      // Going on could extend the block, and every later test would fail anyway.
      if (response.status === 429) stopped = "Stopped real-D1 run after an HTTP 429";
      return response;
    } finally {
      inFlight--;
    }
  };

  const connect: D1Harness["connect"] = (wrap = (next) => next, overrides = {}) =>
    new D1RestAdapter({
      accountId,
      databaseId,
      token,
      fetch: wrap(counted),
      // A real 429 here means the batch is over budget, so fail rather than wait.
      retry: { maxAttempts: 2, baseDelayMs: 200 },
      ...overrides,
    });

  return {
    connect,
    sweep: async () => {
      const sql = new Sql(connect());
      const tables = await sql.run({ sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite~_%' ESCAPE '~' AND name NOT LIKE '~_cf~_%' ESCAPE '~'" });
      if (tables.length === 0) return;
      await sql.batch(tables.map(({ name }) => ({ sql: `DROP TABLE IF EXISTS "${String(name)}"` })));
    },
    measureOverlap: async (work) => {
      peak = inFlight;
      const result = await work();
      return { result, peak };
    },
    leaksToken: (text) => text.includes(token),
    get requests() {
      return requests;
    },
  };
}
