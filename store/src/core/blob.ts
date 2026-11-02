/**
 * What a platform implements to hold bytes. Each adapter calls `assertBlobKey`
 * on every operation.
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

export function assertBlobKey(key: string): void {
  if (!BLOB_KEY.test(key)) {
    throw new RangeError(`Invalid blob key: ${JSON.stringify(key)}`);
  }
}
