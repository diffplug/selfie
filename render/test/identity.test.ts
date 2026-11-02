import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hashTree, rendererIdentity } from "../src/index.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "selfie-hash-tree-"));
  await mkdir(path.join(root, "a"));
  await writeFile(path.join(root, "a", "one"), "1");
  await writeFile(path.join(root, "two"), "22");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("hashTree", () => {
  test("depends on bytes and paths, not on times", async () => {
    const before = await hashTree(root);
    await utimes(path.join(root, "two"), new Date(0), new Date(0));
    expect(await hashTree(root)).toBe(before);
    await writeFile(path.join(root, "two"), "23");
    expect(await hashTree(root)).not.toBe(before);
  });

  test("can't confuse where one file ends and the next starts", async () => {
    await rm(path.join(root, "a"), { recursive: true });
    await writeFile(path.join(root, "x"), "y");
    await writeFile(path.join(root, "z"), "");
    const before = await hashTree(root);
    await writeFile(path.join(root, "x"), "");
    await writeFile(path.join(root, "z"), "y");
    expect(await hashTree(root)).not.toBe(before);
  });

  test("is null for a tree holding a symlink, whose target isn't in the hash", async () => {
    await symlink(path.join(root, "two"), path.join(root, "link"));
    expect(await hashTree(root)).toBeNull();
  });

  test("hashes what it is told to in place of a file's bytes", async () => {
    const before = await hashTree(root);
    const replaced = await hashTree(root, (file, bytes) => (file === "a/one" ? Buffer.from("other") : bytes));
    expect(replaced).not.toBe(before);
  });
});

describe("rendererIdentity", () => {
  test("is the hash of the renderer's source, worker included", async () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    expect(await rendererIdentity()).toBe(await hashTree(src));
    expect(await readFile(path.join(src, "worker", "worker.ts"), "utf8")).toContain("screenshot");
  });
});
