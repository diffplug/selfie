import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../fixtures/png/", import.meta.url));

export function readPngFixture(name: string): Buffer {
  return readFileSync(`${ROOT}${name}`);
}
