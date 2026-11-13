// Every batch's Storybook, kept so its stories can still be opened long after the directory has been
// rebuilt. Files are kept gzipped, by the hash of their bytes as built, so built Storybooks that share files share
// bytes, and a file goes from upload to a browser as it's kept. See docs/specs/store.md -> Built Storybooks.
import type { Blobs } from "./blob.ts";
import { gunzip, gzip } from "./gzip.ts";
import { insertHashKeyStatement } from "./hash-keys.ts";
import { assertImageHash, fromHex, isImageHash, sha256, toHex, truncateHash } from "./image-hash.ts";
import type { Sql } from "./sql.ts";

export const CREATE_BUILT_STORYBOOK_TABLES: readonly string[] = [
  // A row says every file is kept, since it's written last. Its key works as an image's does.
  `CREATE TABLE IF NOT EXISTS built_storybooks (
  key INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE
)`,
];


/** A built Storybook's files by their path in it. Written last and whole, so that having one means having them all. */
type StorybookManifest = Readonly<Record<string, string>>;

// A page load reads a built Storybook's manifest once per file, and a person looks at a few builds at a time.
const MANIFESTS_HELD = 8;

const fileBlobKey = (fileHash: string) => `built-storybook-files-gzip/${fileHash}`;
const manifestBlobKey = (build: string) => `built-storybooks/${build}`;

/** One file of a built Storybook: where it is in the built Storybook, and what `putFile` said its bytes are, as built. */
export interface BuiltStorybookFile {
  readonly path: string;
  readonly fileHash: string;
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

  /** Keeps a file, gzipped, if it isn't here already, and says what to call it: the hash of its bytes as built. */
  async putFile(bytes: Uint8Array): Promise<string> {
    const fileHash = toHex(await sha256(bytes as Uint8Array<ArrayBuffer>));
    const key = fileBlobKey(fileHash);
    if (!(await this.#blob.has(key))) await this.#blob.put(key, await gzip(bytes));
    return fileHash;
  }

  /**
   * Keeps a file already gzipped, as it came, under the hash of its bytes decompressed. Only for a caller that has
   * checked that's what they hash to, since this store can't without holding them whole: see `docs/specs/sync.md`.
   */
  async putGzippedFile(fileHash: string, gzipped: Uint8Array): Promise<void> {
    assertImageHash(fileHash);
    const key = fileBlobKey(fileHash);
    if (!(await this.#blob.has(key))) await this.#blob.put(key, gzipped);
  }

  /** Those of these file hashes whose bytes aren't here, for a sender deciding what to upload. */
  async missingFiles(fileHashes: readonly string[]): Promise<readonly string[]> {
    const held = await Promise.all(fileHashes.map(async (fileHash) => {
      assertImageHash(fileHash);
      return this.#blob.has(fileBlobKey(fileHash));
    }));
    return fileHashes.filter((_, i) => !held[i]);
  }

  /** Each file of a kept built Storybook, or null if it isn't kept. */
  async filesOf(build: string): Promise<readonly BuiltStorybookFile[] | null> {
    assertImageHash(build);
    const manifest = await this.#manifest(build);
    return manifest === null ? null : Object.entries(manifest).map(([path, fileHash]) => ({ path, fileHash }));
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
   * A file of a kept built Storybook, gzipped, as it's kept, or null if there's no such build or file. A path is only
   * ever looked up whole, and never reaches a file system, so nothing in one can climb out of the built Storybook.
   */
  async readGzippedFile(build: string, path: string): Promise<Uint8Array | null> {
    if (!isImageHash(build)) return null;
    const manifest = await this.#manifest(build);
    const fileHash = manifest !== null && Object.hasOwn(manifest, path) ? manifest[path]! : null;
    return fileHash === null ? null : this.#blob.get(fileBlobKey(fileHash));
  }

  /** As `readGzippedFile`, decompressed, for a caller that reads what's in it. */
  async readFile(build: string, path: string): Promise<Uint8Array | null> {
    const gzipped = await this.readGzippedFile(build, path);
    return gzipped === null ? null : gunzip(gzipped);
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
      sql: "UPDATE render_batches SET storybook_key = s.key FROM built_storybooks s WHERE s.hash = ?2 AND render_batches.id = ?1 RETURNING id",
      params: [batchId, build],
      idempotent: true,
    });
    if (rows.length === 0) throw new RangeError(`This store doesn't hold both batch ${batchId} and built Storybook ${build}`);
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
