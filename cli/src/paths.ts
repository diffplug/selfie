// Where local data lives, and the rules that keep untrusted names inside it.
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { SelfieError } from "./errors.ts";
import type { Repo } from "./git.ts";

const READABLE_SLUG_CHARACTERS = 80;
const READABLE_NAME_CHARACTERS = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const shortHash = (value: string, characters: number) =>
  createHash("sha256").update(value).digest("hex").slice(0, characters);

/**
 * The same text for every way of spelling one remote, with no credentials or port. An SSH and
 * an HTTPS clone of one repository share a store, and a token in the URL never reaches a path.
 */
export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  let hostAndPath: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      hostAndPath = `${url.hostname}${url.pathname}`;
    } catch {
      // Unparseable, so drop everything that could be credentials.
      hostAndPath = trimmed.replace(/^[^/]*\/\//, "").replace(/^[^/]*@/, "");
    }
  } else {
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(trimmed);
    hostAndPath = scp === null ? trimmed : `${scp[1]}/${scp[2]!.replace(/^\/+/, "")}`;
  }
  return hostAndPath
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/**
 * A directory name for a project: readable, then a hash that keeps `a/b-c` and `a-b/c` apart.
 * It holds only `[a-z0-9-]`, so it holds no separator or dot: it can't climb out of Selfie's
 * home, and can't be a file there such as `d1.env`.
 */
export function projectSlug({ origin, commonDir }: Pick<Repo, "origin" | "commonDir">): string {
  if (origin === null) return `local-${shortHash(commonDir, 16)}`;
  const normalized = normalizeOrigin(origin);
  const readable = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, READABLE_SLUG_CHARACTERS)
    .replace(/^-+|-+$/g, "");
  return `${readable === "" ? "origin" : readable}-${shortHash(normalized, 8)}`;
}

/** Selfie's home. Holds every project's directory, and `d1.env`, which nothing here reads. */
export function selfieHome(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.SELFIE_HOME || path.join(homedir(), ".config", "selfie"));
}

/**
 * A directory name for a story, whose ID comes from the project's build. No separator, no dot,
 * and a hash so that IDs differing only by case or by punctuation stay apart.
 */
export function storyDirName(story: string): string {
  const readable = story
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, READABLE_NAME_CHARACTERS)
    .replace(/^-+|-+$/g, "");
  return `${readable === "" ? "story" : readable}-${shortHash(story, 10)}`;
}

export const isRunId = (name: string) => UUID.test(name);

/** Refuses anything but a run ID before it reaches a path. */
export function assertRunId(run: string): void {
  if (!isRunId(run)) throw new SelfieError("bad-run-id", `"${run}" isn't a run ID. A review's JSON gives it as runId.`);
}

/** `relative` under `root`, or null if it would land anywhere else. */
export function resolveInside(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null;
}

/**
 * The manifest's path for a file, or why it can't be trusted. The manifest and the directory
 * are both within reach of the worker, so the file must lie under `root` and be a regular file.
 */
export async function regularFileInside(
  root: string,
  relative: string,
): Promise<{ file: string } | { refused: string }> {
  const file = resolveInside(root, relative);
  if (file === null) return { refused: `manifest path ${JSON.stringify(relative)} is outside the output directory` };
  const stats = await lstat(file).catch(() => null);
  if (stats === null) return { refused: `manifest path ${JSON.stringify(relative)} doesn't exist` };
  if (!stats.isFile()) return { refused: `manifest path ${JSON.stringify(relative)} isn't a regular file` };
  return { file };
}
