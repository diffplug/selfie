/** Hashes a complete PAM file. Replaceable so tests can force collisions. */
export type HashFunction = (pam: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

export const SHA256_BYTES = 32;

export const sha256: HashFunction = async (pam) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", pam));

/**
 * The first 53 bits of the digest, read big-endian: the top bits of the hash as
 * it is written in hex, so `BigInt("0x" + hex) >> 203n` gives the same value.
 * That range is 0 to 2^53 − 1, every value a safe integer. The result 0 is not a
 * valid image key; the insert statement sends it to a negative key.
 *
 * Multiplying rather than shifting because JS bit operators stop at 32 bits.
 */
export function truncateHash(digest: Uint8Array): number {
  if (digest.length < 7) {
    throw new RangeError(`Cannot take 53 bits from ${digest.length} bytes`);
  }
  let value = 0;
  for (let i = 0; i < 6; i++) {
    value = value * 256 + digest[i]!;
  }
  return value * 32 + (digest[6]! >>> 3);
}

export function toHex(digest: Uint8Array): string {
  let hex = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
