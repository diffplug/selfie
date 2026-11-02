import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assertBlobKey, type BlobStorage } from "../core/index.ts";

// Blob keys cannot start a segment with a dot, so no key can name this directory.
// It sits under the root to share a filesystem with the keys: rename is only
// atomic within one. A crash can leave an orphan here but never at a key.
const TEMP_DIR = ".tmp";

/**
 * Blobs as files under a root directory, where each key is a relative path. A key
 * may not also be a directory of another key, such as `a` alongside `a/b`.
 */
export class FilesystemBlobStorage implements BlobStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertBlobKey(key);
    const target = join(this.#root, key);
    const tempDir = join(this.#root, TEMP_DIR);
    await mkdir(tempDir, { recursive: true });
    await mkdir(dirname(target), { recursive: true });

    const temp = join(tempDir, randomUUID());
    try {
      const file = await open(temp, "wx");
      try {
        await file.writeFile(bytes);
        // Before the rename, or a power cut could expose a key with missing data.
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    // Before returning, because the caller goes on to write a row that relies on
    // these bytes surviving. Includes the parents mkdir may have just created.
    for (let dir = dirname(target); ; dir = dirname(dir)) {
      await syncDirectory(dir);
      if (dir === this.#root) break;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertBlobKey(key);
    try {
      return new Uint8Array(await readFile(join(this.#root, key)));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    assertBlobKey(key);
    try {
      return (await stat(join(this.#root, key))).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const dir = await open(path, "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

// A key that lands on a directory, or runs through a file, simply isn't a blob.
function isNotFound(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
