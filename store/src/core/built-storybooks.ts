// Every batch's Storybook, kept so its stories can still be opened long after the directory has been
// rebuilt. Files are kept by their hash, as images are, so built Storybooks that share files share bytes.
// See docs/specs/store.md -> built Storybooks.
import type { Blobs } from "./blob.ts";
import { chunks } from "./chunks.ts";
import { assertImageHash, isImageHash, sha256, toHex } from "./image-hash.ts";
import type { Sql } from "./sql.ts";

export const CREATE_BUILT_STORYBOOK_TABLES: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS batch_storybooks (batch_id TEXT PRIMARY KEY, storybook TEXT NOT NULL) WITHOUT ROWID",
  // By environment, whose ID already covers it, so a batch's story can lay out as it was rendered.
  "CREATE TABLE IF NOT EXISTS environment_viewports (environment TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL) WITHOUT ROWID",
  // Only a story that declared a size other than its environment's, so nearly every batch has no rows here.
  "CREATE TABLE IF NOT EXISTS story_viewports (batch_id TEXT NOT NULL, story TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, PRIMARY KEY (batch_id, story)) WITHOUT ROWID",
];

// With the batch's ID, within the SQL interface's 100 bound parameters.
const STORY_VIEWPORTS_PER_STATEMENT = 33;
// The most statements in one request, as `docs/specs/renders.md` -> Requests says of a batch's renders.
const STATEMENTS_PER_REQUEST = 400;

/** A built Storybook's files by their path in it. Written last and whole, so that having one means having them all. */
type StorybookManifest = Readonly<Record<string, string>>;

// A page load reads a built Storybook's manifest once per file, and a person looks at a few builds at a time.
const MANIFESTS_HELD = 8;

const fileBlobKey = (fileHash: string) => `built-storybook-files/${fileHash}`;
const manifestBlobKey = (build: string) => `built-storybooks/${build}`;

/** One file of a built Storybook: where it is in the built Storybook, and what `putFile` said its bytes are. */
export interface BuiltStorybookFile {
  readonly path: string;
  readonly fileHash: string;
}

/** The size a story renders at, in CSS pixels. */
export interface StoryViewport {
  readonly width: number;
  readonly height: number;
}

export class BuiltStorybooks {
  readonly #sql: Sql;
  readonly #blob: Blobs;
  readonly #manifests = new Map<string, StorybookManifest>();

  constructor({ sql, blob }: { readonly sql: Sql; readonly blob: Blobs }) {
    this.#sql = sql;
    this.#blob = blob;
  }

  /** Whether every file of this built Storybook is here. Never true of one that's only partly written. */
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

  /** Says which files make up a built Storybook, once all their bytes are here. The first answer stays. */
  async putStorybook(build: string, files: readonly BuiltStorybookFile[]): Promise<void> {
    if (await this.has(build)) return;
    const manifest: StorybookManifest = Object.fromEntries(files.map(({ path, fileHash }) => [path, fileHash]));
    await this.#blob.put(manifestBlobKey(build), new TextEncoder().encode(JSON.stringify(manifest)));
  }

  /**
   * A file of a kept built Storybook, or null if there's no such build or file. A path is only ever looked up
   * whole, and never reaches a file system, so nothing in one can climb out of the built Storybook.
   */
  async readFile(build: string, path: string): Promise<Uint8Array | null> {
    if (!isImageHash(build)) return null;
    const manifest = await this.#manifest(build);
    const fileHash = manifest !== null && Object.hasOwn(manifest, path) ? manifest[path]! : null;
    return fileHash === null ? null : this.#blob.get(fileBlobKey(fileHash));
  }

  async #manifest(build: string): Promise<StorybookManifest | null> {
    const held = this.#manifests.get(build);
    if (held !== undefined) return held;
    const bytes = await this.#blob.get(manifestBlobKey(build));
    if (bytes === null) return null;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as StorybookManifest;
    if (this.#manifests.size >= MANIFESTS_HELD) this.#manifests.clear();
    this.#manifests.set(build, manifest);
    return manifest;
  }

  /** Says which build rendered a batch, which may be one that isn't kept here. */
  async recordBatchStorybook(batchId: string, build: string): Promise<void> {
    assertImageHash(build);
    await this.#sql.run({
      sql: "INSERT INTO batch_storybooks(batch_id, storybook) VALUES (?1, ?2) ON CONFLICT(batch_id) DO UPDATE SET storybook = excluded.storybook",
      params: [batchId, build],
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

  /** What size an environment renders at, or null for one no batch has recorded this. */
  async viewportOf(environment: string): Promise<StoryViewport | null> {
    const [row] = await this.#sql.run({ sql: "SELECT width, height FROM environment_viewports WHERE environment = ?1", params: [environment], idempotent: true });
    return row === undefined ? null : { width: row.width as number, height: row.height as number };
  }

  /** Says which of a batch's stories rendered at a size other than its environment's. A batch's first answer stays. */
  async recordStoryViewports(batchId: string, viewports: Readonly<Record<string, StoryViewport>>): Promise<void> {
    const statements = chunks(Object.entries(viewports), STORY_VIEWPORTS_PER_STATEMENT).map((group) => ({
      sql: `INSERT OR IGNORE INTO story_viewports(batch_id, story, width, height) VALUES ${group.map((_, i) => `(?1, ?${3 * i + 2}, ?${3 * i + 3}, ?${3 * i + 4})`).join(", ")}`,
      params: [batchId, ...group.flatMap(([story, { width, height }]) => [story, width, height])],
      idempotent: true,
    }));
    for (const request of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(request);
  }

  /** Those of a batch's stories that rendered at a size other than its environment's. */
  async storyViewportsOf(batchId: string): Promise<Readonly<Record<string, StoryViewport>>> {
    const rows = await this.#sql.run({ sql: "SELECT story, width, height FROM story_viewports WHERE batch_id = ?1", params: [batchId], idempotent: true });
    return Object.fromEntries(rows.map(({ story, width, height }) => [story as string, { width: width as number, height: height as number }]));
  }

  /** The built Storybook that rendered a batch, if that's known. */
  async storybookOfBatch(batchId: string): Promise<string | null> {
    const [row] = await this.#sql.run({ sql: "SELECT storybook FROM batch_storybooks WHERE batch_id = ?1", params: [batchId], idempotent: true });
    return (row?.storybook as string | undefined) ?? null;
  }

  /** The built Storybook that rendered a batch, if that's known and kept here. */
  async keptStorybookOfBatch(batchId: string): Promise<string | null> {
    const build = await this.storybookOfBatch(batchId);
    return build !== null && (await this.has(build)) ? build : null;
  }
}
