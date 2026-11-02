import type { Blobs } from "./blob.ts";
import { chunks } from "./chunks.ts";
import {
  assertImageHash,
  SHA256_BYTES,
  sha256,
  toHex,
  truncateHash,
  type HashFunction,
} from "./image-hash.ts";
import { decodeImage } from "./image-file.ts";
import { encodePam } from "./pam.ts";
import { CREATE_SNAPSHOT_TABLES } from "./snapshots.ts";
import type { Sql, SqlStatement } from "./sql.ts";

const CREATE_IMAGES_TABLE = `CREATE TABLE IF NOT EXISTS images (
  key INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE
)`;

// One statement, so concurrent inserts of the same or colliding images cannot
// interleave. The CASTs make a string parameter behave like a number: without
// them a string '0' gets key 0.
//
// Numbered parameters because D1 does not support named ones.
//
// A future delete must handle this: the next negative key is derived from the
// lowest key present, so deleting the row holding it would let that key be reused.
const INSERT_IMAGE = `INSERT INTO images(key, hash)
SELECT CASE WHEN CAST(?1 AS INTEGER) = 0 OR EXISTS(SELECT 1 FROM images WHERE key = CAST(?1 AS INTEGER))
            THEN (SELECT MIN(COALESCE(MIN(key), 0), 0) - 1 FROM images)
            ELSE CAST(?1 AS INTEGER) END, ?2
WHERE true
ON CONFLICT(hash) DO UPDATE SET hash = excluded.hash
RETURNING key`;

const SELECT_IMAGE_KEY = "SELECT key FROM images WHERE hash = ?1";

// Each group's lookup and each group's inserts are one request on D1, whose API limit
// every project shares. A group this size stays far inside what real D1 was measured
// to accept in one batch, and its lookup fits the limit of 100 bound parameters.
const IMAGES_PER_GROUP = 100;

/** The insert statement for one image, given its hash and its truncated hash. */
export function imageInsertStatement(hash: string, truncated: number): SqlStatement {
  // Idempotent: a second run hits ON CONFLICT and returns the key the first assigned.
  return { sql: INSERT_IMAGE, params: [truncated, hash], idempotent: true };
}

/**
 * Creates the store's tables if they are missing, in one request. Safe to call
 * concurrently. It only ever adds: see `docs/specs/snapshots.md` -> Schema.
 */
export async function initStoreSchema(sql: Sql): Promise<void> {
  await sql.batch(
    [CREATE_IMAGES_TABLE, ...CREATE_SNAPSHOT_TABLES].map((statement) => ({
      sql: statement,
      idempotent: true,
    })),
  );
}

export interface StoreOptions {
  readonly sql: Sql;
  readonly blob: Blobs;
  /** Defaults to SHA-256. Tests inject one to force collisions. */
  readonly hash?: HashFunction;
}

export interface StoredImage {
  /** Lowercase hex SHA-256 of the image's PAM file. The same in every store. */
  readonly hash: string;
  /** This store's private key for the image. Meaningless to any other store. */
  readonly key: number;
}

export class Store {
  readonly #sql: Sql;
  readonly #blob: Blobs;
  readonly #hash: HashFunction;

  constructor({ sql, blob, hash = sha256 }: StoreOptions) {
    this.#sql = sql;
    this.#blob = blob;
    this.#hash = hash;
  }

  /**
   * Stores an image file, or finds it if it is already stored. These exact bytes are
   * stored, and the hash comes from decoding them, so they always decode to the pixels
   * that were hashed. The first bytes stored stay: a later encoding of the same pixels
   * changes nothing. Throws `ImageDecodeError` for a file the store doesn't accept.
   */
  async putImage(file: Uint8Array): Promise<StoredImage> {
    const [stored] = await this.putImages([file]);
    return stored!;
  }

  /**
   * Stores image files, or finds those already stored, returning them in order. Use
   * this over repeated `putImage` for many images: it sends far fewer SQL requests. A
   * failure can leave earlier groups stored, and calling this again is safe.
   */
  async putImages(files: readonly Uint8Array[]): Promise<StoredImage[]> {
    const stored: StoredImage[] = [];
    for (const group of chunks(files, IMAGES_PER_GROUP)) {
      stored.push(...(await this.#putGroup(group)));
    }
    return stored;
  }

  async #putGroup(files: readonly Uint8Array[]): Promise<StoredImage[]> {
    const hashes: string[] = [];
    const firstByHash = new Map<string, { file: Uint8Array; digest: Uint8Array }>();
    for (const file of files) {
      const digest = await this.#hash(encodePam(await decodeImage(file)));
      if (digest.length !== SHA256_BYTES) {
        throw new RangeError(`Image hash must be ${SHA256_BYTES} bytes, got ${digest.length}`);
      }
      const hash = toHex(digest);
      hashes.push(hash);
      if (!firstByHash.has(hash)) firstByHash.set(hash, { file, digest });
    }

    // A row means the bytes exist, since they are always written first.
    const keys = await this.#findKeys([...firstByHash.keys()]);
    const missing = [...firstByHash].filter(([hash]) => !keys.has(hash));

    // Bytes first: a failure here or later can orphan bytes, but can never leave a row without them.
    for (const [hash, { file }] of missing) {
      const blobKey = imageBlobKey(hash);
      if (!(await this.#blob.has(blobKey))) await this.#blob.put(blobKey, file);
    }
    if (missing.length > 0) {
      const statements = missing.map(([hash, { digest }]) =>
        imageInsertStatement(hash, truncateHash(digest)),
      );
      const results = await this.#sql.batch(statements);
      results.forEach((rows, i) => keys.set(missing[i]![0], checkedKey(rows[0]?.key)));
    }
    return hashes.map((hash) => ({ hash, key: keys.get(hash)! }));
  }

  /** The key of each of these distinct hashes that has a row. */
  async #findKeys(hashes: readonly string[]): Promise<Map<string, number>> {
    const params = hashes.map((_, i) => `?${i + 1}`).join(", ");
    const rows = await this.#sql.run({
      sql: `SELECT key, hash FROM images WHERE hash IN (${params})`,
      params: hashes,
      idempotent: true,
    });
    return new Map(rows.map((row) => [row.hash as string, checkedKey(row.key)]));
  }

  /** This store's key for an image hash, or null if the image is not stored. */
  async lookupKey(hash: string): Promise<number | null> {
    assertImageHash(hash);
    // By the full hash, never by truncated value: a colliding image must not
    // resolve to the key of the image that claimed that value first.
    const [row] = await this.#sql.run({
      sql: SELECT_IMAGE_KEY,
      params: [hash],
      idempotent: true,
    });
    return row === undefined ? null : (row.key as number);
  }

  /**
   * The stored file for an image hash, or null if the image is not stored. It can
   * be served as it is, as `imageMediaType` says. Bytes with no row are orphans from a
   * failed insert, so they count as not stored.
   */
  async getImage(hash: string): Promise<Uint8Array | null> {
    if ((await this.lookupKey(hash)) === null) return null;
    const bytes = await this.#blob.get(imageBlobKey(hash));
    if (bytes === null) {
      throw new Error(`Image ${hash} has a row but no bytes`);
    }
    return bytes;
  }
}

function checkedKey(key: unknown): number {
  if (typeof key !== "number" || !Number.isSafeInteger(key)) {
    throw new TypeError(`Image query returned an invalid key: ${String(key)}`);
  }
  return key;
}

function imageBlobKey(hash: string): string {
  return `images/${hash}`;
}
