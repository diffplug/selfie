import type { Blobs } from "./blob.ts";
import { SHA256_BYTES, sha256, toHex, truncateHash, type HashFunction } from "./image-hash.ts";
import { encodePam, type RawImage } from "./pam.ts";
import { decodePng, encodePng } from "./png.ts";
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

const IMAGE_HASH = /^[0-9a-f]{64}$/;

// Each group is one request on D1, whose API limit every project shares. A group
// this size stays far inside what real D1 was measured to accept in one batch.
const INSERTS_PER_REQUEST = 100;

/** The insert statement for one image, given its hash and its truncated hash. */
export function imageInsertStatement(hash: string, truncated: number): SqlStatement {
  // Idempotent: a second run hits ON CONFLICT and returns the key the first assigned.
  return { sql: INSERT_IMAGE, params: [truncated, hash], idempotent: true };
}

/** Creates the store's tables if they are missing. Safe to call concurrently. */
export async function initStoreSchema(sql: Sql): Promise<void> {
  await sql.run({ sql: CREATE_IMAGES_TABLE, idempotent: true });
}

export interface StoreOptions {
  readonly sql: Sql;
  readonly blob: Blobs;
  /** Defaults to SHA-256. Tests inject one to force collisions. */
  readonly hash?: HashFunction;
}

/**
 * An image already encoded as a PNG, such as a rendered screenshot. Its bytes are
 * stored as they are, and its hash comes from decoding them, so they always decode
 * to the pixels that were hashed.
 */
export interface PngImage {
  readonly png: Uint8Array;
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
   * Stores an image, or finds it if it is already stored. Its first stored bytes
   * stay: a later encoding of the same pixels changes nothing. Throws
   * `ImageDecodeError` for a PNG that isn't exactly 8-bit opaque RGB.
   */
  async putImage(image: RawImage | PngImage): Promise<StoredImage> {
    const [stored] = await this.putImages([image]);
    return stored!;
  }

  /**
   * Stores images, or finds those already stored, returning them in order. Use this
   * over repeated `putImage` for many images: it sends far fewer SQL requests. A
   * failure can leave earlier images stored, and calling this again is safe.
   */
  async putImages(images: readonly (RawImage | PngImage)[]): Promise<StoredImage[]> {
    const stored: StoredImage[] = [];
    for (let i = 0; i < images.length; i += INSERTS_PER_REQUEST) {
      const prepared: { hash: string; statement: SqlStatement }[] = [];
      for (const image of images.slice(i, i + INSERTS_PER_REQUEST)) {
        prepared.push(await this.#writeBytes(image));
      }
      const results = await this.#sql.batch(prepared.map(({ statement }) => statement));
      results.forEach((rows, j) => {
        const key = rows[0]?.key;
        if (typeof key !== "number" || !Number.isSafeInteger(key)) {
          throw new TypeError(`Image insert returned an invalid key: ${String(key)}`);
        }
        stored.push({ hash: prepared[j]!.hash, key });
      });
    }
    return stored;
  }

  /** Bytes first: a failure here or later can orphan bytes, but can never leave a row without them. */
  async #writeBytes(image: RawImage | PngImage): Promise<{ hash: string; statement: SqlStatement }> {
    const digest = await this.#hash(encodePam("png" in image ? await decodePng(image.png) : image));
    if (digest.length !== SHA256_BYTES) {
      throw new RangeError(`Image hash must be ${SHA256_BYTES} bytes, got ${digest.length}`);
    }
    const hash = toHex(digest);

    const blobKey = imageBlobKey(hash);
    if (!(await this.#blob.has(blobKey))) {
      await this.#blob.put(blobKey, "png" in image ? image.png : await encodePng(image));
    }
    return { hash, statement: imageInsertStatement(hash, truncateHash(digest)) };
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
   * The stored PNG for an image hash, or null if the image is not stored. It can
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

function imageBlobKey(hash: string): string {
  return `images/${hash}`;
}

function assertImageHash(hash: string): void {
  if (!IMAGE_HASH.test(hash)) {
    throw new RangeError(`Not an image hash: ${JSON.stringify(hash)}`);
  }
}
