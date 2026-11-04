import type { Blobs } from "./blob.ts";
import { chunks, mapConcurrently } from "./chunks.ts";
import {
  assertImageHash,
  fromHex,
  SHA256_BYTES,
  sha256,
  toHex,
  truncateHash,
  type HashFunction,
} from "./image-hash.ts";
import { checkImageFile, decodeImage, webpToKeep, type ImageCodec } from "./image-file.ts";
import { encodePam, type RawImage } from "./pam.ts";
import { CREATE_BATCH_TABLES } from "./render-batches.ts";
import { CREATE_BUILT_STORYBOOK_TABLES } from "./built-storybooks.ts";
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
const QUERIES_PER_REQUEST = 50;

const findKeysStatement = (hashes: readonly string[]): SqlStatement => ({
  sql: `SELECT key, hash FROM images WHERE hash IN (${hashes.map((_, i) => `?${i + 1}`).join(", ")})`,
  params: hashes,
  idempotent: true,
});
// Encoding is most of a first review. Each one holds a whole image, so this also bounds memory.
const BLOBS_AT_ONCE = 4;

/** The insert statement for one image, given its hash and its truncated hash. */
export function imageInsertStatement(hash: string, truncated: number): SqlStatement {
  // Idempotent: a second batch hits ON CONFLICT and returns the key the first assigned.
  return { sql: INSERT_IMAGE, params: [truncated, hash], idempotent: true };
}

/**
 * Creates the store's tables if they are missing, in one request. Safe to call
 * concurrently. It only ever adds: see `docs/specs/renders.md` -> Schema.
 */
export async function initStoreSchema(sql: Sql): Promise<void> {
  await sql.batch(
    [CREATE_IMAGES_TABLE, ...CREATE_BATCH_TABLES, ...CREATE_BUILT_STORYBOOK_TABLES].map((statement) => ({
      sql: statement,
      idempotent: true,
    })),
  );
}

export interface ReceivingStoreOptions {
  readonly sql: Sql;
  readonly blob: Blobs;
}

export interface StoreOptions extends ReceivingStoreOptions {
  readonly codec: ImageCodec;
  /** Defaults to SHA-256. Tests inject one to force collisions. */
  readonly hash?: HashFunction;
}

export interface StoredImage {
  /** Lowercase hex SHA-256 of the image's PAM file. The same in every store. */
  readonly hash: string;
  /** This store's private key for the image. Meaningless to any other store. */
  readonly key: number;
}

/** These bytes are a different image from the one they were sent as. */
export class ImageHashMismatchError extends Error {
  override readonly name = "ImageHashMismatchError";

  constructor(actual: string, expected: string) {
    super(`These bytes are image ${actual}, and not ${expected}.`);
  }
}

/**
 * What a store can do without reading pixels, which is all a Worker can do: it takes files under
 * the hash they're sent with, and serves them. `Store` adds everything that needs a codec.
 */
export class ReceivingStore {
  protected readonly sql: Sql;
  protected readonly blob: Blobs;

  constructor({ sql, blob }: ReceivingStoreOptions) {
    this.sql = sql;
    this.blob = blob;
  }

  /**
   * Stores a file another store sent, under the hash it was sent with, without decoding it, or
   * finds that hash if it's already stored, keeping the first bytes. Throws `ImageDecodeError`
   * only if the file's form is one no store keeps. So what's stored here may not be the image
   * its hash names: see `docs/specs/store.md` -> Image identity. One SQL request, with no lookup
   * first, since a sender has just asked what's missing, and the insert finds a row anyway.
   */
  async receiveImage(file: Uint8Array, hash: string): Promise<StoredImage> {
    assertImageHash(hash);
    checkImageFile(file);
    // Bytes first, as ever, so a row always means the bytes exist.
    const blobKey = imageBlobKey(hash);
    if (!(await this.blob.has(blobKey))) await this.blob.put(blobKey, file);
    const [row] = await this.sql.run(imageInsertStatement(hash, truncateHash(fromHex(hash))));
    return { hash, key: checkedKey(row?.key) };
  }

  /** Which of these images this store doesn't hold, so another store need only send those. */
  async missingImages(hashes: readonly string[]): Promise<readonly string[]> {
    const distinct = [...new Set(hashes)];
    for (const hash of distinct) assertImageHash(hash);
    const held = new Set<string>();
    const statements = chunks(distinct, IMAGES_PER_GROUP).map((group) => findKeysStatement(group));
    // Most are usually held, so this many statements in a request stay within a request's rows.
    for (const batch of chunks(statements, QUERIES_PER_REQUEST)) {
      for (const rows of await this.sql.batch(batch)) for (const row of rows) held.add(row.hash as string);
    }
    return distinct.filter((hash) => !held.has(hash));
  }

  /** This store's key for an image hash, or null if the image is not stored. */
  async lookupKey(hash: string): Promise<number | null> {
    assertImageHash(hash);
    // By the full hash, never by truncated value: a colliding image must not
    // resolve to the key of the image that claimed that value first.
    const [row] = await this.sql.run({
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
    const bytes = await this.blob.get(imageBlobKey(hash));
    if (bytes === null) {
      throw new Error(`Image ${hash} has a row but no bytes`);
    }
    return bytes;
  }
}

export class Store extends ReceivingStore {
  readonly #hash: HashFunction;
  readonly #codec: ImageCodec;

  constructor({ sql, blob, hash = sha256, codec }: StoreOptions) {
    super({ sql, blob });
    this.#hash = hash;
    this.#codec = codec;
  }

  /**
   * Stores an image file, or finds it if it is already stored. The hash comes from
   * decoding it. A new PNG is kept as a WebP, checked to decode to the same hash, unless it
   * is too large for one. Anything else is kept as these exact bytes, so what's stored here
   * always decodes to the pixels that were hashed. The first bytes stored stay: a later
   * encoding of the same pixels changes nothing. Throws `ImageDecodeError` for a file the
   * store doesn't accept. Given the hash another store knows it by, it throws
   * `ImageHashMismatchError` before storing anything if these bytes aren't that image.
   */
  async putImage(file: Uint8Array, expectedHash?: string): Promise<StoredImage> {
    const [stored] = await this.#putGroup([file], expectedHash);
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

  async #putGroup(files: readonly Uint8Array[], expectedHash?: string): Promise<StoredImage[]> {
    const hashes: string[] = [];
    const firstByHash = new Map<string, { file: Uint8Array; digest: Uint8Array }>();
    for (const file of files) {
      const digest = await this.#digestOf(file);
      const hash = toHex(digest);
      if (expectedHash !== undefined && hash !== expectedHash) throw new ImageHashMismatchError(hash, expectedHash);
      hashes.push(hash);
      if (!firstByHash.has(hash)) firstByHash.set(hash, { file, digest });
    }

    // A row means the bytes exist, since they are always written first.
    const keys = await this.#findKeys([...firstByHash.keys()]);
    const missing = [...firstByHash].filter(([hash]) => !keys.has(hash));

    // Bytes first: a failure here or later can orphan bytes, but can never leave a row without them.
    await mapConcurrently(missing, BLOBS_AT_ONCE, async ([hash, { file }]) => {
      const blobKey = imageBlobKey(hash);
      if (!(await this.blob.has(blobKey))) await this.blob.put(blobKey, await this.#fileToKeep(file, hash));
    });
    if (missing.length > 0) {
      const statements = missing.map(([hash, { digest }]) =>
        imageInsertStatement(hash, truncateHash(digest)),
      );
      const results = await this.sql.batch(statements);
      results.forEach((rows, i) => keys.set(missing[i]![0], checkedKey(rows[0]?.key)));
    }
    return hashes.map((hash) => ({ hash, key: keys.get(hash)! }));
  }

  async #digestOf(file: Uint8Array): Promise<Uint8Array> {
    const digest = await this.#hash(encodePam(await decodeImage(file, this.#codec)));
    if (digest.length !== SHA256_BYTES) {
      throw new RangeError(`Image hash must be ${SHA256_BYTES} bytes, got ${digest.length}`);
    }
    return digest;
  }

  /** Only for an image not yet stored, so an unchanged image costs no encoding. */
  async #fileToKeep(file: Uint8Array, hash: string): Promise<Uint8Array> {
    const encoded = await webpToKeep(file, this.#codec);
    if (encoded === null) return file;
    if (toHex(await this.#digestOf(encoded)) !== hash) throw new Error("The WebP encoder changed an image's pixels");
    return encoded;
  }

  /** The key of each of these distinct hashes that has a row. */
  async #findKeys(hashes: readonly string[]): Promise<Map<string, number>> {
    const rows = await this.sql.run(findKeysStatement(hashes));
    return new Map(rows.map((row) => [row.hash as string, checkedKey(row.key)]));
  }

  /**
   * The stored file, after decoding it to check it's the image its hash names, or null if the
   * image is not stored. What a store sends another, since the receiver may not check. Throws
   * `ImageDecodeError` or `ImageHashMismatchError` if it isn't.
   */
  async getCheckedImage(hash: string): Promise<Uint8Array | null> {
    const file = await this.getImage(hash);
    if (file === null) return null;
    const actual = toHex(await this.#digestOf(file));
    if (actual !== hash) throw new ImageHashMismatchError(actual, hash);
    return file;
  }

  /** The exact pixels of a stored image, or null if the image is not stored. */
  async getPixels(hash: string): Promise<RawImage | null> {
    const file = await this.getImage(hash);
    return file === null ? null : decodeImage(file, this.#codec);
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
