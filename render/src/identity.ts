// What decides a build's pixels, as one string, so a review can recognize a build that already
// rendered. Beside `capture`, so a new capture option that can change pixels sits next to this.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { environmentId, type RenderEnvironment } from "./environment.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const initScriptHash = (initScript: string | undefined) => (initScript === undefined ? null : sha256(initScript));

/**
 * What differs between two builds of the same source, and which nothing in a build loads, so it
 * can't change a pixel: docs/specs/cli.rationale.md -> Recording only if necessary. Exact paths
 * and exact text: a build where these don't match just hashes differently, which only renders.
 */
const VOLATILE_TEXT = new Map([
  ["project.json", /^\{"generatedAt":\d+,/],
  ["manifests/components.html", /Generation took <strong>[\d.]+s<\/strong>/],
]);

function withoutVolatileText(file: string, bytes: Buffer): Uint8Array {
  const volatile = VOLATILE_TEXT.get(file);
  // latin1 keeps every byte as one character, so nothing else about the file can change here.
  return volatile === undefined ? bytes : Buffer.from(bytes.toString("latin1").replace(volatile, ""), "latin1");
}

/**
 * A SHA-256 of every file's relative path and bytes, whatever their sizes and times. Null if the
 * directory holds anything but files and directories, since what a symlink reaches isn't hashed.
 */
async function hashTree(
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

/**
 * Changes whenever a render of this build could: its bytes, the environment, the init script, or
 * the renderer's own code, which also covers its defaults, and which a package version wouldn't
 * in a checkout. Null if a render can't be recognized: a native machine's ID doesn't describe all
 * of it, and a build that's missing or holds a symlink can't be hashed.
 */
export async function renderIdentity({
  storybookDir,
  environment,
  initScript,
}: {
  readonly storybookDir: string;
  readonly environment: RenderEnvironment;
  readonly initScript?: string | undefined;
}): Promise<string | null> {
  if (environment.runner.kind !== "container") return null;
  const build = await hashTree(storybookDir, withoutVolatileText).catch(() => null);
  if (build === null) return null;
  const renderer = await hashTree(fileURLToPath(new URL(".", import.meta.url)));
  return sha256(JSON.stringify([build, environmentId(environment), initScriptHash(initScript), renderer]));
}
