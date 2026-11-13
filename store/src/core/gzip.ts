// gzip, by the platform's own streams, which Node, a Worker, and a browser all have. See docs/specs/store.md -> Built Storybooks.

const streamOf = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(streamOf(bytes).pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

/** The bytes gzip holds, for what this store kept itself. Something sent is checked as it streams, by `selfie-ui/sync`. */
export async function gunzip(gzipped: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(streamOf(gzipped).pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
