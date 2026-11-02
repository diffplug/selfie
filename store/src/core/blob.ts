/**
 * What a platform implements to hold bytes. Adapters only store: every rule about
 * keys lives in `Blobs`, so no adapter can forget one.
 */
export interface BlobStorage {
  /**
   * Stores the bytes so that they are complete at the key or absent from it,
   * never partial. Idempotent: callers only ever put the same bytes at a key, so
   * a retry or a concurrent put of that key is safe.
   */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes at the key, or null if there are none. */
  get(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
}

// Lowercase because local filesystems may fold case. Each segment starts with a
// letter or digit, so a key can't climb out of a directory or name a hidden
// path such as an adapter's temp directory.
const BLOB_KEY = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

function assertBlobKey(key: string): void {
  if (!BLOB_KEY.test(key)) {
    throw new RangeError(`Invalid blob key: ${JSON.stringify(key)}`);
  }
}

/**
 * The blob interface the store core uses. Refuses an invalid key before any
 * adapter sees it.
 *
 * A class with a private field rather than an interface, so that a bare adapter
 * cannot be passed where `Blobs` is expected and skip the check.
 */
export class Blobs implements BlobStorage {
  readonly #adapter: BlobStorage;

  constructor(adapter: BlobStorage) {
    this.#adapter = adapter;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertBlobKey(key);
    await this.#adapter.put(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertBlobKey(key);
    return this.#adapter.get(key);
  }

  async has(key: string): Promise<boolean> {
    assertBlobKey(key);
    return this.#adapter.has(key);
  }
}
