import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../fixtures/png/", import.meta.url));

/** Every PNG fixture as base64, by its path under `test/fixtures/png`. workerd can't read files. */
export function pngFixturesAsBase64(): Record<string, string> {
  const names = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter((name) =>
    name.endsWith(".png"),
  );
  return Object.fromEntries(names.map((name) => [name, readPngFixture(name).toString("base64")]));
}

export function readPngFixture(name: string): Buffer {
  return readFileSync(`${ROOT}${name}`);
}
