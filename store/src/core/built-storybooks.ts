// Every batch's Storybook, kept so its stories can still be opened long after the directory has been
// rebuilt. Files are kept by their hash, as images are, so built Storybooks that share files share bytes.
// See docs/specs/store.md -> built Storybooks.
import type { Blobs } from "./blob.ts";
import { chunks, STATEMENTS_PER_REQUEST } from "./chunks.ts";
import { insertHashKeyStatement } from "./hash-keys.ts";
import { assertImageHash, fromHex, isImageHash, sha256, toHex, truncateHash } from "./image-hash.ts";
import type { Sql } from "./sql.ts";

export const CREATE_BUILT_STORYBOOK_TABLES: readonly string[] = [
  // A row says every file is kept, since it's written last. Its key works as an image's does.
  `CREATE TABLE IF NOT EXISTS built_storybooks (
  key INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE
)`,
  // By environment, whose ID already covers it, so a batch's story can lay out as it was rendered.
  "CREATE TABLE IF NOT EXISTS environment_viewports (environment TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL) WITHOUT ROWID",
  // Only a story that declared a size other than its environment's, so nearly every batch has no rows here.
  "CREATE TABLE IF NOT EXISTS story_viewports (batch_id TEXT NOT NULL REFERENCES render_batches(id), story TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, PRIMARY KEY (batch_id, story)) WITHOUT ROWID",
];


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

  /** Whether every file of this built Storybook is here, from the table alone. Never true of one that's only partly written. */
  async has(build: string): Promise<boolean> {
    assertImageHash(build);
    const rows = await this.#sql.run({ sql: "SELECT 1 AS found FROM built_storybooks WHERE hash = ?1", params: [build], idempotent: true });
    return rows.length > 0;
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
    // Left by a crash before the row, it's still this build's first answer.
    if (!(await this.#blob.has(manifestBlobKey(build)))) {
      const manifest: StorybookManifest = Object.fromEntries(files.map(({ path, fileHash }) => [path, fileHash]));
      await this.#blob.put(manifestBlobKey(build), new TextEncoder().encode(JSON.stringify(manifest)));
    }
    await this.#sql.run(insertHashKeyStatement("built_storybooks", build, truncateHash(fromHex(build))));
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

  /** Says which kept built Storybook rendered a batch. Refuses a batch or a built Storybook this store doesn't hold. */
  async recordBatchStorybook(batchId: string, build: string): Promise<void> {
    assertImageHash(build);
    const rows = await this.#sql.run({
      sql: "UPDATE render_batches SET storybook_key = (SELECT key FROM built_storybooks WHERE hash = ?2) WHERE id = ?1 AND EXISTS (SELECT 1 FROM built_storybooks WHERE hash = ?2) RETURNING id",
      params: [batchId, build],
      idempotent: true,
    });
    if (rows.length === 0) throw new RangeError(`This store doesn't hold both batch ${batchId} and built Storybook ${build}`);
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
    const statements = Object.entries(viewports).map(([story, { width, height }]) => ({
      sql: "INSERT OR IGNORE INTO story_viewports(batch_id, story, width, height) VALUES (?1, ?2, ?3, ?4)",
      params: [batchId, story, width, height],
      idempotent: true,
    }));
    for (const request of chunks(statements, STATEMENTS_PER_REQUEST)) await this.#sql.batch(request);
  }

  /** Those of a batch's stories that rendered at a size other than its environment's. */
  async storyViewportsOf(batchId: string): Promise<Readonly<Record<string, StoryViewport>>> {
    const rows = await this.#sql.run({ sql: "SELECT story, width, height FROM story_viewports WHERE batch_id = ?1", params: [batchId], idempotent: true });
    return Object.fromEntries(rows.map(({ story, width, height }) => [story as string, { width: width as number, height: height as number }]));
  }

  /** The kept built Storybook that rendered a batch, if there is one. */
  async storybookOfBatch(batchId: string): Promise<string | null> {
    const [row] = await this.#sql.run({
      sql: "SELECT s.hash FROM render_batches r JOIN built_storybooks s ON s.key = r.storybook_key WHERE r.id = ?1",
      params: [batchId],
      idempotent: true,
    });
    return (row?.hash as string | undefined) ?? null;
  }
}
