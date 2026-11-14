// What a gzipped upload holds, checked as it streams, so a server holds only what was sent. Node and a Worker with
// `nodejs_compat` both hash a stream by `node:crypto`, which Web Crypto can't. See docs/specs/sync.md -> What a store takes.
import { createHash } from "node:crypto";

/** Bytes that would be more than a caller takes once decompressed. */
export class TooLargeError extends Error {}

/**
 * The hex SHA-256 of what gzip holds, refusing what isn't gzip with a `RangeError`, and stopping with `TooLargeError`
 * once it passes `maxBytes`, so a small body can't make a server do unbounded work.
 */
export async function sha256OfGzipped(gzipped: Uint8Array, maxBytes: number): Promise<string> {
  // Enqueued as it is, since a `Blob` would copy what may be most of a Worker's memory.
  const sent = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(gzipped as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = sent.pipeThrough(new DecompressionStream("gzip")).getReader();
  const hash = createHash("sha256");
  let length = 0;
  for (;;) {
    const read = await reader.read().catch((error: unknown) => {
      throw new RangeError("That isn't gzip.", { cause: error });
    });
    if (read.done) return hash.digest("hex");
    length += read.value.length;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLargeError(`It's more than ${maxBytes} bytes once decompressed.`);
    }
    hash.update(read.value);
  }
}
