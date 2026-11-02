import type { SqlAdapter, SqlRow, SqlStatement } from "../core/index.ts";

export interface D1RestRetryOptions {
  /** Total tries for one `execute`, the first included. */
  readonly maxAttempts: number;
  /** The wait before the first retry when the response names none. Doubles each retry. */
  readonly baseDelayMs: number;
  /** The longest single wait. A 429 asking for longer fails at once instead of waiting. */
  readonly maxDelayMs: number;
}

export interface D1RestConfig {
  readonly accountId: string;
  readonly databaseId: string;
  readonly token: string;
  /** Defaults to the platform's `fetch`. */
  readonly fetch?: typeof fetch;
  readonly retry?: Partial<D1RestRetryOptions>;
  /** Defaults to `setTimeout`. Tests inject one to observe the backoff without waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: D1RestRetryOptions = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 30_000 };

// Cloudflare resolves an API request within 30 seconds, so this only trips on a
// request that is already lost.
const REQUEST_TIMEOUT_MS = 35_000;

// The messages Cloudflare's D1 docs say to retry, which say nothing of whether a
// write took effect: https://developers.cloudflare.com/d1/observability/debug-d1/
const TRANSIENT_D1_MESSAGES = [
  "D1 DB reset because its code was updated",
  "Internal error while starting up D1 DB storage caused object to be reset",
  "Network connection lost",
  "Replica disconnected from primary",
  "Internal error in D1 DB storage caused object to be reset",
  "Cannot resolve D1 DB due to transient issue on remote node",
  "Can't read from request stream because client disconnected",
];

/** A D1 REST request failed. Carries D1's own messages, and never the token. */
export class D1RestError extends Error {
  override readonly name = "D1RestError";
  /** The HTTP status, if a response arrived. */
  readonly status: number | undefined;
  /** Cloudflare's error codes, such as 7500 for a statement D1 refused. */
  readonly codes: readonly number[];
  /** True when nothing confirmed the outcome, so the statements may have taken effect. */
  readonly outcomeUnknown: boolean;
  /** On a 429, how long Cloudflare asked to wait, if it said. */
  readonly retryAfterMs: number | undefined;
  /** How many requests this `execute` sent. */
  readonly attempts: number;

  constructor(message: string, failure: Failure, attempts: number) {
    super(message);
    this.status = failure.status;
    this.codes = failure.codes;
    this.outcomeUnknown = failure.kind === "unknown";
    this.retryAfterMs = failure.retryAfterMs;
    this.attempts = attempts;
  }
}

interface Failure {
  /**
   * - `rejected`: Cloudflare refused the request unrun, so any statement may be resent.
   * - `unknown`: nothing confirms what happened, so only idempotent statements may be.
   * - `final`: D1 answered, and asking again would get the same answer.
   */
  readonly kind: "rejected" | "unknown" | "final";
  readonly detail: string;
  readonly status?: number;
  readonly codes: readonly number[];
  readonly retryAfterMs?: number;
}

/**
 * SQL through the D1 REST API, using only Web-standard APIs so it runs in a
 * Worker and in Node. One `execute` is one REST request, retries aside. What it
 * resends, and when, is in `docs/specs/store.md` -> "D1 REST adapter".
 */
export class D1RestAdapter implements SqlAdapter {
  readonly #url: string;
  // Private fields, so the token cannot surface by logging or serializing the adapter.
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #retry: D1RestRetryOptions;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(config: D1RestConfig) {
    if (!config.token) throw new TypeError("D1RestAdapter needs a token");
    // Checked here because the platform's own header check quotes the value it refuses.
    if (!/^[\x21-\x7e]+$/.test(config.token)) {
      throw new TypeError("D1RestAdapter's token has characters a header can't hold");
    }
    if (!config.accountId) throw new TypeError("D1RestAdapter needs an account ID");
    if (!config.databaseId) throw new TypeError("D1RestAdapter needs a database ID");
    const account = encodeURIComponent(config.accountId);
    const database = encodeURIComponent(config.databaseId);
    this.#url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
    this.#token = config.token;
    // Called bare: a Worker's `fetch` throws when invoked as a method of something else.
    const platformFetch = config.fetch ?? globalThis.fetch;
    this.#fetch = (input, init) => platformFetch(input, init);
    this.#retry = { ...DEFAULT_RETRY, ...config.retry };
    this.#sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(statements: readonly SqlStatement[]): Promise<SqlRow[][]> {
    // D1 refuses an empty batch.
    if (statements.length === 0) return [];
    const body = JSON.stringify({
      batch: statements.map(({ sql, params = [] }) => ({ sql, params })),
    });
    const replayable = statements.every((statement) => statement.idempotent === true);

    for (let attempt = 1; ; attempt++) {
      const outcome = await this.#attempt(body, statements.length);
      if ("rows" in outcome) return outcome.rows;

      const delay = this.#retryDelay(outcome, attempt, replayable);
      if (delay === undefined) throw this.#toError(outcome, attempt, replayable);
      await this.#sleep(delay);
    }
  }

  /** How long to wait before resending, or undefined to give up. */
  #retryDelay(failure: Failure, attempt: number, replayable: boolean): number | undefined {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.#retry;
    if (attempt >= maxAttempts) return undefined;
    if (failure.kind === "final") return undefined;
    if (failure.kind === "unknown" && !replayable) return undefined;
    if (failure.retryAfterMs !== undefined) {
      if (failure.retryAfterMs > maxDelayMs) return undefined;
      // Spread out, so clients sharing the limit don't all return at the same instant.
      return failure.retryAfterMs + Math.random() * baseDelayMs;
    }
    const ceiling = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    return ceiling / 2 + (Math.random() * ceiling) / 2;
  }

  async #attempt(body: string, expected: number): Promise<{ rows: SqlRow[][] } | Failure> {
    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      return { kind: "unknown", detail: describeThrown(error), codes: [] };
    }

    const payload = parsePayload(text);
    const errors = payload?.errors ?? [];
    const codes = errors.flatMap(({ code }) => (typeof code === "number" ? [code] : []));
    const status = response.status;
    const detail = errors.length > 0 ? describeErrors(errors) : snippet(text);
    const fail = (kind: Failure["kind"], reason = detail, retryAfterMs?: number): Failure => ({
      kind,
      detail: reason,
      status,
      codes,
      retryAfterMs,
    });

    if (status === 429) {
      return fail("rejected", detail, parseRetryAfter(response.headers.get("Retry-After")));
    }
    if (status >= 500 || TRANSIENT_D1_MESSAGES.some((message) => detail.includes(message))) {
      return fail("unknown");
    }
    if (!response.ok || payload?.success === false) return fail("final");
    if (payload === undefined || !Array.isArray(payload.result)) {
      return fail("unknown", `Unreadable response: ${snippet(text)}`);
    }

    if (payload.result.some((result) => result.success === false)) {
      return fail("final", "D1 reported a failed statement");
    }
    // Would mean D1 split a statement in two, so the rows can't be matched to statements.
    if (payload.result.length !== expected) {
      return fail("final", `Sent ${expected} statements but got ${payload.result.length} results`);
    }
    return { rows: payload.result.map((result) => result.results ?? []) };
  }

  #toError(failure: Failure, attempts: number, replayable: boolean): D1RestError {
    const parts = [
      "D1 REST request failed",
      ...(failure.status === undefined ? [] : [`HTTP ${failure.status}`]),
      ...(failure.detail === "" ? [] : [failure.detail]),
    ];
    let message = parts.join(": ");
    message += ` (${attempts} ${attempts === 1 ? "attempt" : "attempts"})`;
    if (failure.retryAfterMs !== undefined) {
      message += `. Cloudflare asked to wait ${Math.ceil(failure.retryAfterMs / 1000)}s`;
    }
    if (failure.kind === "unknown") {
      message += replayable
        ? ". The statements may have taken effect"
        : ". The statements may have taken effect, and were not resent since not all are idempotent";
    }
    // Everything above can echo text from a platform we don't control. A header
    // value that fetch refuses, for one, is quoted in the error it throws.
    return new D1RestError(message.replaceAll(this.#token, () => "[redacted]"), failure, attempts);
  }
}

interface D1Payload {
  readonly success?: boolean;
  readonly errors?: readonly { readonly code?: unknown; readonly message?: unknown }[];
  readonly result?: readonly {
    readonly success?: boolean;
    readonly results?: SqlRow[];
  }[];
}

function parsePayload(text: string): D1Payload | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const payload = parsed as D1Payload;
    return Array.isArray(payload.errors) || payload.errors === undefined
      ? payload
      : { ...payload, errors: [] };
  } catch {
    return undefined;
  }
}

function describeErrors(errors: NonNullable<D1Payload["errors"]>): string {
  return errors.map(({ code, message }) => `[${String(code)}] ${String(message)}`).join("; ");
}

/** The start of a response that isn't D1's JSON, such as a gateway's HTML page. */
function snippet(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function describeThrown(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.name}: ${error.message}${cause}`;
}

/** Cloudflare documents this as whole seconds, so anything else counts as absent. */
function parseRetryAfter(header: string | null): number | undefined {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header) * 1000 : undefined;
}
