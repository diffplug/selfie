import { isBlobKeySegment, type BlobStorage } from "../core/index.ts";

/**
 * The part of a Worker's R2 binding this adapter uses, stated here so the store
 * needs no Cloudflare types. A real `R2Bucket` satisfies it, which typecheck
 * confirms in `store/test/workerd`.
 */
export interface R2BucketLike {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<unknown>;
}

export interface R2BlobStorageConfig {
  readonly bucket: R2BucketLike;
  /**
   * One path segment that belongs to this project alone. The same identifier
   * reaches the same objects, so it must never pass to a different project.
   */
  readonly project: string;
  /** Defaults to `setTimeout`. Tests inject one to observe the backoff without waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1_000;

// R2 allows one write per second per key and throws error 10058 for more:
// https://developers.cloudflare.com/r2/api/error-codes/
// Matched on the message because the binding's errors carry no `code` in workerd,
// although its types declare one. A test pins that, so this gets revisited if it changes.
const KEY_RATE_LIMITED = /\(10058\)$/;

/**
 * Blobs in R2, through a Worker binding. Each object is
 * `projects/<project>/<blob key>`, so projects in one bucket never share one.
 */
export class R2BlobStorage implements BlobStorage {
  readonly #bucket: R2BucketLike;
  readonly #prefix: string;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(config: R2BlobStorageConfig) {
    const { project } = config;
    // Checked as a string first: a regex test would accept `undefined` as "undefined".
    // One segment has no `/`, so no project's prefix can sit inside another's.
    if (typeof project !== "string" || !isBlobKeySegment(project)) {
      throw new RangeError(`Invalid project: ${JSON.stringify(project)}`);
    }
    this.#bucket = config.bucket;
    this.#prefix = `projects/${project}/`;
    this.#sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const objectKey = this.#objectKey(key);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#bucket.put(objectKey, bytes);
        return;
      } catch (error) {
        if (!isKeyRateLimited(error)) throw error;
        // Callers only put the same bytes at a key, and R2 is strongly consistent,
        // so a blob here means another writer has already done this put.
        if ((await this.#bucket.head(objectKey)) !== null) return;
        if (attempt >= MAX_ATTEMPTS) throw error;
      }
      const ceiling = BASE_DELAY_MS * 2 ** (attempt - 1);
      await this.#sleep(ceiling / 2 + (Math.random() * ceiling) / 2);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const object = await this.#bucket.get(this.#objectKey(key));
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async has(key: string): Promise<boolean> {
    return (await this.#bucket.head(this.#objectKey(key))) !== null;
  }

  #objectKey(key: string): string {
    return this.#prefix + key;
  }
}

function isKeyRateLimited(error: unknown): boolean {
  return error instanceof Error && KEY_RATE_LIMITED.test(error.message);
}
