# Store — Rationale

> Informative companion to [store.md](store.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Image identity

**Opaque only.** All 1,016 Chromium screenshots captured so far, 2026-11, are 8-bit RGB PNGs with no alpha channel. They came from one app's Storybook through Playwright, without `omitBackground`. Taking RGB directly means a bulk copy, where taking RGBA cost about 6.7 ms per 1200×900 image to scan alpha and strip it, in a micro-benchmark of equivalent loops. Support for transparency could be added later without changing any existing hash, because an RGBA PAM has a different header.

## Image decoding

**Why so narrow.** All 746 real Chromium screenshots checked, from Linux and macOS at 1× and 2× scale, are 8-bit RGB holding only `IHDR`, `IDAT`, and `IEND`. PNG is a stand-in and uploads are untrusted, so breadth nobody uses is only parser surface. All-255 RGBA stays because rendering environments are configurable. This can be widened later without changing any hash, since the hash covers decoded pixels.

**No library.** `store/src/core/image-file.ts` runs on the platform's own `DecompressionStream`, and adds no dependency.

| Option | License | Why not |
|---|---|---|
| `fast-png` 8.0.0 | MIT | Decoded every screenshot exactly, but silently accepted a row cut short, 256 MiB of image data declared as 1×1, and an animated file, with `checkCrc: true`. Its API exposes neither the inflate nor the chunks, so a wrapper can't fix this |
| `sharp` 0.35.5 | Apache-2.0, with LGPL-3.0-or-later libvips | Native, so it can't be in the core or run in a Worker |
| `@jsquash/png` 3.1.1 | Apache-2.0 | Exact in workerd in the benchmark, but Node and Workers load its WASM differently, so it would need injecting, and it would still need a chunk scan |
| `pngjs` 7.0.0 | MIT | Needs Node streams and `node:zlib`, with no release since 2023 |

**Checked against `sharp`.** Every pixel of those 746 screenshots matches, in a one-off run outside the test suite. The suite pins 2 of them and 8 PngSuite files to hashes `sharp` computed.

**Speed.** Over those 746 in Node, mostly 1200×900, the median decode was 6.7 ms (p95 25 ms), against about 10 ms for `fast-png` and about 2 ms for `sharp`. No test has run on a real Worker.

**The pixel limit.** 100,000,000 is a judgment call, and what a Worker does near its 128 MB limit was not tested.

**Where decoding runs.** In a Worker for any upload through `Store`, since taking the hash from the decoded file is what ties bytes to their hash. Serving doesn't decode.

## Storage

**Format in the bytes, not in a column.** PNG, WebP, and JPEG XL all open with a fixed signature, so reading the first bytes needs no schema change and can't drift from what's stored. A column would need a migration ([Open questions](store.md#open-questions)), and a suffix on the blob key would make `has` check every format.

**No migration of PAM blobs.** Before this change a blob held a PAM file. No store has held real images yet: the only data is test data, so nothing converts them.

**A row means the bytes exist.** Bytes are always written before the row, so a group already stored costs one SQL request and no blob calls. The cost is that putting an image again no longer repairs a blob lost some other way: `Store.getImage` still reports a row with no bytes as an error.

**First bytes, not strictly.** The store checks and then writes, so concurrent first puts can both write, and the blob ends as either. Making that strict would take a conditional put in every adapter, for no change in what the bytes decode to.

## Stored encoding

Evidence for the open question, from a lossless comparison over 434 screenshots at 1× and 2×, 2026-11. Its full report isn't in the repo.

- Storing Playwright's PNG as it is costs no encoding time, at about 508 MB per 10,000 images.
- Lossless WebP through `sharp`, at `webp({ lossless: true, effort: 4 })`, is about 3× smaller and adds about 18 ms per 1200×900 image. It is the comparison's recommendation.
- A switch changes the write path: something must encode before `Store.putImage`, on the machine rendering, since `sharp` is native and the benchmark found encoding inside a Worker unsafe at 2× scale. `decodeImage` would then need a WebP decoder that runs in Workers, and `imageMediaType` its signature. The hash wouldn't change.

## Adapters

**Statement size limit.** Measured on real D1, 2026-11: a 100,000 byte statement runs, and 100,001 fails with `SQLITE_TOOBIG`. Nothing checked this locally before, so an oversized query would only have failed in the cloud.

**Comments after the closing semicolon.** Measured on real D1, 2026-11: `SELECT 1; -- done` fails with `SQL code did not contain a statement`, where local SQLite runs it.

## D1 REST adapter

**No separate D1 limit.** [Cloudflare's API limits page](https://developers.cloudflare.com/fundamentals/api/reference/limits/) names the APIs with separate limits, and D1 is not one. [D1's limits page](https://developers.cloudflare.com/d1/platform/limits/) lists no request rate. This rests on the docs not listing one, and was not tested.

**No visible quota.** Measured on real D1, 2026-11: its responses carry no `Ratelimit` headers, despite Cloudflare's general docs describing them.

**Failed batches.** Measured on real D1, 2026-11: a failed `batch` rolled back its earlier statements, but the docs don't promise it, so the SQL interface treats batches as non-atomic. A 2,000 statement batch succeeded; nothing larger was tested.

## R2 adapter

**Recognizing error 10058 by message.** `R2Error` in `@cloudflare/workers-types` declares a `code`, but the binding's errors had none when tested in local workerd, 2026-11, on a real error 10020. So the adapter matches the `(10058)` that ends the message. Real R2 has not been tested, and a reworded message would turn a concurrent put into a failure.
