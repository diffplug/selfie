// What two images' differences are, worked out where images can be decoded, and kept for a server that
// can't decode them. Named by both hashes, so anything that compares those two images shares it.
import type { Blobs } from "./blob.ts";
import { assertImageHash } from "./image-hash.ts";

const statsKey = (current: string, golden: string) => `diffs/${current}/${golden}.json`;
const imageKey = (current: string, golden: string) => `diffs/${current}/${golden}.png`;

export class StoredDiffs {
  readonly #blob: Blobs;

  constructor(blob: Blobs) {
    this.#blob = blob;
  }

  /** Before its stats, which say that both are here. */
  async putImage(current: string, golden: string, png: Uint8Array): Promise<void> {
    assertImageHash(current);
    assertImageHash(golden);
    await this.#blob.put(imageKey(current, golden), png);
  }

  async putStats(current: string, golden: string, statsJson: string): Promise<void> {
    assertImageHash(current);
    assertImageHash(golden);
    await this.#blob.put(statsKey(current, golden), new TextEncoder().encode(statsJson));
  }

  async has(current: string, golden: string): Promise<boolean> {
    assertImageHash(current);
    assertImageHash(golden);
    return this.#blob.has(statsKey(current, golden));
  }

  /** The stats as they were sent, or null. */
  async stats(current: string, golden: string): Promise<string | null> {
    const bytes = await this.#blob.get(statsKey(current, golden));
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  async image(current: string, golden: string): Promise<Uint8Array | null> {
    return this.#blob.get(imageKey(current, golden));
  }
}
