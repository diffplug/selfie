import { describe, expect, it } from "vitest";
import {
  Sql,
  SqlInterfaceError,
  type SqlAdapter,
  type SqlParam,
  type SqlStatement,
} from "../src/core/index.ts";

// Spelled out, not imported, so changing the limit in the code fails this suite.
const LIMIT = 100;

function recording() {
  const seen: SqlStatement[] = [];
  const adapter: SqlAdapter = {
    execute: async (statements) => {
      seen.push(...statements);
      return statements.map(() => []);
    },
  };
  return { sql: new Sql(adapter), seen };
}

const accepts = async (text: string, params: SqlParam[] = []) => {
  const { sql, seen } = recording();
  await sql.run(text, params);
  expect(seen).toHaveLength(1);
};

const refuses = async (text: string, params: SqlParam[] = []) => {
  const { sql, seen } = recording();
  await expect(sql.run(text, params)).rejects.toThrow(SqlInterfaceError);
  expect(seen).toEqual([]);
};

describe("Sql", () => {
  it("does not accept a bare adapter in its place", () => {
    const adapter: SqlAdapter = { execute: async () => [] };
    // @ts-expect-error A bare adapter would skip the checks. Enforced by typecheck.
    const bare: Sql = adapter;
    expect(bare).toBe(adapter);
  });

  describe("the bound parameter limit never reaches an adapter", () => {
    const anonymous = (count: number) => `SELECT ${Array(count).fill("?").join(", ")}`;
    const values = (count: number) => Array.from({ length: count }, () => "x");

    it("passes at the limit", () =>
      accepts(anonymous(LIMIT), values(LIMIT)));

    it("refuses over the limit", () =>
      refuses(anonymous(LIMIT + 1), values(LIMIT + 1)));

    it("counts a high numbered parameter the way SQLite does", () =>
      refuses(`SELECT ?${LIMIT + 1}`, values(LIMIT + 1)));

    it("counts a reused numbered parameter once", () => accepts("SELECT ?1, ?1, ?1", ["x"]));

    it("refuses every statement of a batch if one is over", async () => {
      const { sql, seen } = recording();
      const over = LIMIT + 1;
      await expect(
        sql.batch([{ sql: "SELECT 1" }, { sql: anonymous(over), params: values(over) }]),
      ).rejects.toThrow(SqlInterfaceError);
      expect(seen).toEqual([]);
    });

    it("refuses too many values for a statement with no placeholders", () =>
      refuses("SELECT 1", values(LIMIT + 1)));
  });

  describe("parameter counting", () => {
    it("refuses a missing parameter, which SQLite would bind to NULL", () =>
      refuses("SELECT ?1, ?2", ["x"]));

    it("refuses an extra parameter", () => refuses("SELECT ?1", ["x", "y"]));

    it("continues a bare ? above the highest numbered one", async () => {
      await accepts("SELECT ?5, ?", ["1", "2", "3", "4", "5", "6"]);
      await refuses("SELECT ?5, ?", ["1", "2", "3", "4", "5"]);
    });

    it.each([
      ["a string", "SELECT '?1 :x ;'"],
      ["an escaped string", "SELECT 'it''s ?1'"],
      ["a quoted identifier", 'SELECT 1 AS "?1 :x"'],
      ["a backtick identifier", "SELECT 1 AS `?1`"],
      ["a bracket identifier", "SELECT 1 AS [?1]"],
      ["a line comment", "SELECT 1 -- ?1 :x ; more\n"],
      ["a block comment", "SELECT /* ?1 :x ; */ 1"],
      ["an identifier containing $", "SELECT a$b FROM t"],
    ])("ignores what looks like a parameter inside %s", (_, text) => accepts(text));

    it.each([NaN, Infinity, -Infinity])("refuses the number %s", (value) =>
      refuses("SELECT ?1", [value]),
    );

    it("refuses a value outside the parameter types at runtime", () =>
      refuses("SELECT ?1", [null as unknown as string]));
  });

  describe("what not every adapter supports", () => {
    it.each(["SELECT :name", "SELECT @name", "SELECT $name"])("refuses named parameters: %s", (text) =>
      refuses(text, ["x"]),
    );

    it.each([
      "SELECT 1; SELECT 2",
      "SELECT 1; -- comment\nSELECT 2",
      "SELECT 1;;",
    ])("refuses more than one statement: %s", (text) => refuses(text));

    it("allows one trailing semicolon and comment", () => accepts("SELECT 1; -- done\n"));

    it.each(["", "  \n", "-- only a comment", ";"])("refuses an empty statement: %j", (text) =>
      refuses(text),
    );

    it.each([
      "BEGIN",
      "begin transaction",
      "COMMIT",
      "END",
      "ROLLBACK",
      "SAVEPOINT s",
      "RELEASE s",
      "ATTACH 'x' AS y",
      "DETACH y",
      "/* sneaky */ BEGIN",
    ])("refuses transaction and attachment statements: %s", (text) => refuses(text));
  });
});
