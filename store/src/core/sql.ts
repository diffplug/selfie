export type SqlParam = string | number;
export type SqlValue = string | number | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlParam[];
  /**
   * Running this again, after it may already have run, returns the same rows and
   * changes nothing further. An adapter may then resend it after a failure that
   * leaves the outcome unknown, such as a lost response. Absent means it must not.
   */
  readonly idempotent?: boolean;
}

/**
 * What a platform implements. Adapters only execute: every rule about what may
 * reach them lives in `Sql`, so no adapter can forget one.
 */
export interface SqlAdapter {
  /**
   * Runs the statements in order, as one request where the platform has such a
   * thing, resolving to each statement's rows. Rejects if any statement fails.
   * Which of the others took effect is unspecified: D1 may roll them back, and
   * local SQLite does not.
   */
  execute(statements: readonly SqlStatement[]): Promise<SqlRow[][]>;
}

const MAX_BOUND_PARAMETERS = 100;
const MAX_STATEMENT_BYTES = 100_000;

/** A statement was refused before reaching any adapter. */
export class SqlInterfaceError extends Error {
  override readonly name = "SqlInterfaceError";
}

/**
 * The SQL interface the store core uses. Refuses, before any adapter runs it,
 * whatever would behave differently on another adapter.
 *
 * A class with a private field rather than an interface, so that a bare adapter
 * cannot be passed where `Sql` is expected and skip the checks.
 */
export class Sql {
  readonly #adapter: SqlAdapter;

  constructor(adapter: SqlAdapter) {
    this.#adapter = adapter;
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<SqlRow[]> {
    return this.runStatement({ sql, params });
  }

  /** Like `run`, for a statement that says more about itself than its text. */
  async runStatement(statement: SqlStatement): Promise<SqlRow[]> {
    const [rows] = await this.batch([statement]);
    return rows ?? [];
  }

  /** Several statements in one request, with no atomicity across them. */
  async batch(statements: readonly SqlStatement[]): Promise<SqlRow[][]> {
    statements.forEach(checkStatement);
    return this.#adapter.execute(statements);
  }
}

// Strings, quoted identifiers, and comments come first so nothing inside them is
// read as a parameter or a statement separator. Identifiers are consumed whole
// because `$` is legal inside one.
const TOKEN =
  /'[^']*(?:''[^']*)*'|"[^"]*(?:""[^"]*)*"|`[^`]*(?:``[^`]*)*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[\p{L}_][\p{L}\p{N}_$]*|\?\d*|[:@$][\p{L}\p{N}_]+|\s+|[\s\S]/uy;

// D1 refuses these, and the interface offers no transactions.
const FORBIDDEN_FIRST_KEYWORDS = new Set([
  "ATTACH",
  "BEGIN",
  "COMMIT",
  "DETACH",
  "END",
  "RELEASE",
  "ROLLBACK",
  "SAVEPOINT",
]);

function checkStatement({ sql, params = [] }: SqlStatement): void {
  const bytes = new TextEncoder().encode(sql).length;
  if (bytes > MAX_STATEMENT_BYTES) {
    throw new SqlInterfaceError(
      `Statement is ${bytes} bytes, the limit is ${MAX_STATEMENT_BYTES}`,
    );
  }
  const needed = inspectSql(sql);
  if (needed > MAX_BOUND_PARAMETERS) {
    throw new SqlInterfaceError(
      `Statement uses ${needed} bound parameters, the limit is ${MAX_BOUND_PARAMETERS}`,
    );
  }
  // Exact, because SQLite silently binds a missing parameter to NULL.
  if (params.length !== needed) {
    throw new SqlInterfaceError(
      `Statement uses ${needed} bound parameters but was given ${params.length}`,
    );
  }
  for (const param of params) {
    if (typeof param === "number" ? !Number.isFinite(param) : typeof param !== "string") {
      throw new SqlInterfaceError(`Bound parameter must be a string or finite number: ${param}`);
    }
  }
}

/** Validates the shape of one statement and returns how many parameters it binds. */
function inspectSql(sql: string): number {
  let highest = 0;
  let first: string | undefined;
  let ended = false;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(sql); match !== null; match = TOKEN.exec(sql)) {
    const token = match[0];
    if (/^\s/.test(token)) continue;
    const isComment = token.startsWith("--") || token.startsWith("/*");
    // node:sqlite silently ignores everything after the first statement, and D1
    // fails on a comment after it with "SQL code did not contain a statement".
    if (ended) {
      throw new SqlInterfaceError(
        isComment
          ? "A comment may not follow a statement's closing semicolon: D1 refuses it"
          : "Only one statement may be run at a time",
      );
    }
    if (isComment) continue;
    if (token === ";") {
      ended = true;
      continue;
    }
    first ??= token;
    if (token.startsWith("?")) {
      // Same numbering as SQLite: a bare `?` is one above the highest so far.
      highest = token.length > 1 ? Math.max(highest, Number(token.slice(1))) : highest + 1;
    } else if (token.length > 1 && /^[:@$]/.test(token)) {
      throw new SqlInterfaceError(
        `Use ?NNN or ? parameters: D1 does not support named parameters such as ${token}`,
      );
    }
  }
  if (first === undefined) throw new SqlInterfaceError("Statement is empty");
  if (FORBIDDEN_FIRST_KEYWORDS.has(first.toUpperCase())) {
    throw new SqlInterfaceError(`The SQL interface does not offer ${first.toUpperCase()}`);
  }
  return highest;
}
