import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemBlobStorage } from "../src/adapters/filesystem-blob.ts";

const PUT_PROCESS = fileURLToPath(new URL("./support/put-blob-process.ts", import.meta.url));
const BLOB_SIZE = 256 * 1024 * 1024;

describe("FilesystemBlobStorage", () => {
  let root: string;
  let blob: FilesystemBlobStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "selfie-fs-blob-"));
    blob = new FilesystemBlobStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const tempFiles = () => {
    const directory = join(root, ".tmp");
    return existsSync(directory) ? readdirSync(directory) : [];
  };

  it("keeps a key absent and readable after a crash mid-write", async () => {
    const child = spawn(process.execPath, [PUT_PROCESS, root, "images/crash", String(BLOB_SIZE)], {
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));

    // Blocks this thread on purpose, so the kill lands as soon as the temp file exists.
    const deadline = Date.now() + 30_000;
    let names = tempFiles();
    while (names.length === 0 && Date.now() < deadline) names = tempFiles();
    child.kill("SIGKILL");
    await exited;

    // The write really was cut off, so this isn't passing because it finished.
    expect(names).toHaveLength(1);
    const orphan = join(root, ".tmp", names[0]!);
    expect(statSync(orphan).size).toBeLessThan(BLOB_SIZE);

    expect(await blob.has("images/crash")).toBe(false);
    expect(await blob.get("images/crash")).toBeNull();

    // A later put succeeds, with the orphan left behind harmlessly.
    const bytes = new Uint8Array([1, 2, 3]);
    await blob.put("images/crash", bytes);
    expect(await blob.get("images/crash")).toEqual(bytes);
  });

  it("removes its temp file and leaves the key absent when a write fails", async () => {
    // A directory at the target makes the final rename fail.
    await blob.put("images/occupied/inner", new Uint8Array([1]));
    await expect(blob.put("images/occupied", new Uint8Array([2]))).rejects.toThrow();
    expect(tempFiles()).toEqual([]);
    expect(await blob.get("images/occupied/inner")).toEqual(new Uint8Array([1]));
  });

  it("leaves no temp files after a successful put", async () => {
    await blob.put("images/a", new Uint8Array([1]));
    expect(tempFiles()).toEqual([]);
  });

  it("keeps a previous blob intact when a later put of the key fails", async () => {
    await blob.put("images/a", new Uint8Array([1, 2, 3]));
    await chmod(join(root, ".tmp"), 0o500);
    try {
      await expect(blob.put("images/a", new Uint8Array([1, 2, 3]))).rejects.toThrow();
    } finally {
      await chmod(join(root, ".tmp"), 0o755);
    }
    expect(await blob.get("images/a")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("stores a key as the matching path under the root", async () => {
    await blob.put("images/a", new Uint8Array([1]));
    expect(await readdir(join(root, "images"))).toEqual(["a"]);
  });

  it("does not write outside the root for a refused key", async () => {
    await expect(blob.put("../escape", new Uint8Array([1]))).rejects.toThrow(RangeError);
    expect(existsSync(join(root, "..", "escape"))).toBe(false);
  });

  it("reports read errors other than a missing key", async () => {
    await blob.put("images/a", new Uint8Array([1]));
    await chmod(join(root, "images"), 0o000);
    try {
      await expect(blob.has("images/a")).rejects.toThrow();
      await expect(blob.get("images/a")).rejects.toThrow();
    } finally {
      await chmod(join(root, "images"), 0o755);
    }
  });

  it("works from an unnormalized root", async () => {
    const unnormalized = new FilesystemBlobStorage(`${root}/./`);
    await unnormalized.put("images/a", new Uint8Array([1]));
    expect(await unnormalized.get("images/a")).toEqual(new Uint8Array([1]));
  });
});
