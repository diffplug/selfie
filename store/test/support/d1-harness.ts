import { D1RestAdapter, type D1RestConfig } from "../../src/adapters/d1-rest.ts";
import { Sql, type SqlAdapter } from "../../src/core/index.ts";
import { CONTRACT_DATABASE_ID, loadD1Credentials } from "./d1-credentials.ts";

// One real run sends about 400 requests against Cloudflare's 1,200 per 5 minutes,
// and going over blocks all API calls for 5 minutes. This stops a run that has gone
// wrong well before that. It doesn't protect repeated runs: don't loop this suite.
const REQUEST_BUDGET = 600;

/** Wiring for tests against the real contract database, and a count of what they send. */
export interface D1Harness {
  /** A new adapter, and so a new connection. `wrap` sits between it and the counted fetch. */
  connect(wrap?: (next: typeof fetch) => typeof fetch): SqlAdapter;
  /** Drops every table except D1's own, leaving the database empty. */
  sweep(): Promise<void>;
  /** Runs `work`, also returning the most requests that were in flight at once during it. */
  measureOverlap<T>(work: () => Promise<T>): Promise<{ result: T; peak: number }>;
  /** Asks without exposing the token to the caller, so a failing assertion can't print it. */
  leaksToken(text: string): boolean;
  readonly requests: number;
}

let shared: Promise<D1Harness> | undefined;

/** The one harness of this process, so its budget covers the whole run. */
export function d1Harness(): Promise<D1Harness> {
  shared ??= createHarness();
  return shared;
}

async function createHarness(): Promise<D1Harness> {
  const { accountId, token } = await loadD1Credentials();
  let requests = 0;
  let inFlight = 0;
  let peak = 0;
  let stopped: string | undefined;

  const counted: typeof fetch = async (input, init) => {
    if (stopped !== undefined) throw new Error(stopped);
    if (requests >= REQUEST_BUDGET) {
      stopped = `Stopped real-D1 run at its budget of ${REQUEST_BUDGET} requests`;
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

  const connect = (wrap: (next: typeof fetch) => typeof fetch = (next) => next): SqlAdapter => {
    const config: D1RestConfig = {
      accountId,
      databaseId: CONTRACT_DATABASE_ID,
      token,
      fetch: wrap(counted),
      // A real 429 here means the run is over budget, so fail rather than wait.
      retry: { maxAttempts: 2, baseDelayMs: 200 },
    };
    return new D1RestAdapter(config);
  };

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
