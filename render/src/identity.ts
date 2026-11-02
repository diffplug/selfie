import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A SHA-256 of every file's relative path and bytes under a directory, whatever their sizes and
 * times. Null if it holds anything but files and directories, since what a symlink reaches isn't
 * in the hash. `bytesToHash` may stand in for a file's own bytes.
 */
export async function hashTree(
  root: string,
  bytesToHash: (file: string, bytes: Buffer) => Uint8Array = (_, bytes) => bytes,
): Promise<string | null> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() && !entry.isDirectory())) return null;
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = bytesToHash(file, await readFile(path.join(root, file)));
    // The length keeps one file's end from reading as the next one's start.
    hash.update(`${file}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest("hex");
}

let identity: Promise<string> | undefined;

/**
 * The renderer's own code, so a change to how pixels are made is seen whatever the package's
 * version says, which in a checkout never changes.
 */
export function rendererIdentity(): Promise<string> {
  identity ??= hashTree(fileURLToPath(new URL(".", import.meta.url))).then((hash) => hash ?? "unhashable");
  return identity;
}
