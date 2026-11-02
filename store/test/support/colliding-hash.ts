import type { HashFunction, RawImage } from "../../src/core/index.ts";

/** A 1×1 image whose red channel identifies it, as `collidingHash` expects. */
export const image = (id: number): RawImage => ({
  width: 1,
  height: 1,
  pixels: new Uint8Array([id, 0, 0, 255]),
});

/**
 * Forces the first 53 bits of the hash to the value assigned to the image's id,
 * with the rest of the digest unique to the image. The id is the red channel,
 * which is the fourth-to-last byte of a 1×1 PAM.
 */
export function collidingHash(truncatedById: Record<number, number>): HashFunction {
  return async (pam) => {
    const id = pam[pam.length - 4]!;
    const truncated = truncatedById[id] ?? 1000 + id;
    const digest = new Uint8Array(32);
    // Written as the top bits: the first 7 bytes hold truncated × 8.
    let rest = truncated;
    digest[6] = (rest % 32) << 3;
    rest = Math.floor(rest / 32);
    for (let i = 5; i >= 0; i--) {
      digest[i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    digest[31] = id;
    return digest;
  };
}
