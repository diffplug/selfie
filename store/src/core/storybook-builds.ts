// Every run's Storybook, kept so its stories can still be opened long after the directory has been
// rebuilt. Files are kept by their hash, as images are, so builds that share files share bytes.
// See docs/specs/store.md -> Storybook builds.
import type { Blobs } from "./blob.ts";
import { assertImageHash, isImageHash, sha256, toHex } from "./image-hash.ts";
import type { Sql } from "./sql.ts";

export const CREATE_STORYBOOK_BUILD_TABLES: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS run_builds (run_id TEXT PRIMARY KEY, build TEXT NOT NULL) WITHOUT ROWID",
  // By environment, whose ID already covers it, so a run's story can lay out as it was rendered.
  "CREATE TABLE IF NOT EXISTS environment_viewports (environment TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL) WITHOUT ROWID",
];

/** A build's files by their path in it. Written last and whole, so that having one means having them all. */
type BuildManifest = Readonly<Record<string, string>>;

// A page load reads a build's manifest once per file, and a person looks at a few builds at a time.
const MANIFESTS_HELD = 8;

const fileBlobKey = (fileHash: string) => `storybook-files/${fileHash}`;
const manifestBlobKey = (build: string) => `storybook-builds/${build}`;

/** One file of a build: where it is in the build, and what `putFile` said its bytes are. */
export interface StorybookBuildFile {
  readonly path: string;
  readonly fileHash: string;
}

/** The size a story renders at, in CSS pixels. */
export interface StoryViewport {
  readonly width: number;
  readonly height: number;
}

export class StorybookBuilds {
  readonly #sql: Sql;
  readonly #blob: Blobs;
  readonly #manifests = new Map<string, BuildManifest>();

  constructor({ sql, blob }: { readonly sql: Sql; readonly blob: Blobs }) {
    this.#sql = sql;
    this.#blob = blob;
  }

  /** Whether every file of this build is here. Never true of one that's only partly written. */
  has(build: string): Promise<boolean> {
    assertImageHash(build);
    return this.#blob.has(manifestBlobKey(build));
  }

  /** Keeps a file's bytes, if they aren't here already, and says what to call them. */
  async putFile(bytes: Uint8Array): Promise<string> {
    const fileHash = toHex(await sha256(bytes as Uint8Array<ArrayBuffer>));
    const key = fileBlobKey(fileHash);
    if (!(await this.#blob.has(key))) await this.#blob.put(key, bytes);
    return fileHash;
  }

  /** Says which files make up a build, once all their bytes are here. The first answer stays. */
  async putBuild(build: string, files: readonly StorybookBuildFile[]): Promise<void> {
    if (await this.has(build)) return;
    const manifest: BuildManifest = Object.fromEntries(files.map(({ path, fileHash }) => [path, fileHash]));
    await this.#blob.put(manifestBlobKey(build), new TextEncoder().encode(JSON.stringify(manifest)));
  }

  /**
   * A file of a kept build, or null if there's no such build or file. A path is only ever looked up
   * whole, and never reaches a file system, so nothing in one can climb out of the build.
   */
  async readFile(build: string, path: string): Promise<Uint8Array | null> {
    if (!isImageHash(build)) return null;
    const manifest = await this.#manifest(build);
    const fileHash = manifest !== null && Object.hasOwn(manifest, path) ? manifest[path]! : null;
    return fileHash === null ? null : this.#blob.get(fileBlobKey(fileHash));
  }

  async #manifest(build: string): Promise<BuildManifest | null> {
    const held = this.#manifests.get(build);
    if (held !== undefined) return held;
    const bytes = await this.#blob.get(manifestBlobKey(build));
    if (bytes === null) return null;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as BuildManifest;
    if (this.#manifests.size >= MANIFESTS_HELD) this.#manifests.clear();
    this.#manifests.set(build, manifest);
    return manifest;
  }

  /** Says which build rendered a run, which may be one that isn't kept here. */
  async recordRunBuild(runId: string, build: string): Promise<void> {
    assertImageHash(build);
    await this.#sql.run({
      sql: "INSERT INTO run_builds(run_id, build) VALUES (?1, ?2) ON CONFLICT(run_id) DO UPDATE SET build = excluded.build",
      params: [runId, build],
      idempotent: true,
    });
  }

  /** Says what size an environment renders at, which can't change, since its ID covers it. */
  async recordViewport(environment: string, { width, height }: StoryViewport): Promise<void> {
    await this.#sql.run({
      sql: "INSERT OR IGNORE INTO environment_viewports(environment, width, height) VALUES (?1, ?2, ?3)",
      params: [environment, width, height],
      idempotent: true,
    });
  }

  /** What size an environment renders at, or null for one no run has recorded this. */
  async viewportOf(environment: string): Promise<StoryViewport | null> {
    const [row] = await this.#sql.run({ sql: "SELECT width, height FROM environment_viewports WHERE environment = ?1", params: [environment], idempotent: true });
    return row === undefined ? null : { width: row.width as number, height: row.height as number };
  }

  /** The build that rendered a run, if that's known. */
  async buildOfRun(runId: string): Promise<string | null> {
    const [row] = await this.#sql.run({ sql: "SELECT build FROM run_builds WHERE run_id = ?1", params: [runId], idempotent: true });
    return (row?.build as string | undefined) ?? null;
  }

  /** The build that rendered a run, if that's known and kept here. */
  async keptBuildOfRun(runId: string): Promise<string | null> {
    const build = await this.buildOfRun(runId);
    return build !== null && (await this.has(build)) ? build : null;
  }
}
