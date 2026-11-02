# Store — Rationale

> Informative companion to [store.md](store.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Image identity

**Opaque only.** All 1,016 Chromium screenshots captured so far, 2026-11, are 8-bit RGB PNGs with no alpha channel. They came from one app's Storybook through Playwright, without `omitBackground`. Taking RGB directly means a bulk copy, where taking RGBA cost about 6.7 ms per 1200×900 image to scan alpha and strip it, in a micro-benchmark of equivalent loops. Support for transparency could be added later without changing any existing hash, because an RGBA PAM has a different header.

## Image decoding

**Why so narrow.** All 746 real Chromium screenshots checked, from Linux and macOS at 1× and 2× scale, are 8-bit RGB holding only `IHDR`, `IDAT`, and `IEND`. PNG is only what Chromium hands over and uploads are untrusted, so breadth nobody uses is only parser surface. All-255 RGBA stays because rendering environments are configurable. This can be widened later without changing any hash, since the hash covers decoded pixels.

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

**Why WebP.** A lossless comparison over 434 screenshots at 1× and 2×, 2026-11, recommended it over keeping PNG and over JPEG XL. Its full report isn't in the repo. On dormouse's 541 stories captured as whole pages, in the same comparison's terms:

| | 1× | 1.5× | 2× |
|---|---|---|---|
| PNG as written | 25.2 MB | 44.6 MB | 62.1 MB |
| WebP at `effort: 4` | 8.0 MB | 13.6 MB | 18.7 MB |
| Encoding, average per image | 28 ms | 52 ms | 83 ms |
| Decoding, average per image | 5 ms | 9 ms | 13 ms |

All 1,623 of those images came back from `sharp` with exactly the same pixels, in the simple `VP8L` form, with the alpha bit clear.

**What a review pays.** On those 541 stories at 1×, on one Mac, the store step of a review took about 20 s with every image new, writing 4 at a time, and about 6 s with every image already stored. It took about 36 s with every image new when writing one at a time. Blobs took 8.8 MB, against 25.2 MB of PNG.

**The fallback.** 16,384 on either side was refused by `sharp`, with 16,383 accepted. The tallest of those stories is 9,898, so it stays rare, but it's only a few lines since PNG decoding has to exist anyway for what Chromium writes.

**Encoding in the store.** The rule was once that the store never encodes. Encoding before `Store.putImages` would encode every image of every run, when nearly all of them are already stored, since only the store knows which are new. So it asks an injected codec, for new images only.

**`sharp`'s license.** `sharp` is Apache-2.0. Its prebuilt `@img/sharp-libvips-*` packages are LGPL-3.0-or-later, installed as separate npm packages and linked dynamically. That was read from their `package.json` files, and isn't legal advice.

## A Worker reading a WebP

`@jsquash/webp` 1.5.0 (Apache-2.0, libwebp as WebAssembly) decoded real images inside `workerd` 1.20261023.1, run locally, and its pixels hashed the same as `sharp`'s:

| Image | Took | Process memory, before and at its peak |
|---|---|---|
| 1200×900 | 14 ms | 37 to 62 MB |
| 1200×4949 | 42 ms | 62 to 140 MB |
| 2400×1800 | 30 ms | 140 to 170 MB |
| 2400×5898 | 96 ms | 170 to 328 MB |
| 2400×9898 | 169 ms | 305 to 531 MB |

That prototype held RGBA and then RGB, in one process that didn't return memory between images, and nothing ran on real Cloudflare. Cloudflare's docs list a Worker's memory at 128 MB. So a very tall page at 2× likely won't fit, and PNG would have the same trouble, since hashing needs all the raw pixels whatever the format.

## Adapters

**Statement size limit.** Measured on real D1, 2026-11: a 100,000 byte statement runs, and 100,001 fails with `SQLITE_TOOBIG`. Nothing checked this locally before, so an oversized query would only have failed in the cloud.

**Comments after the closing semicolon.** Measured on real D1, 2026-11: `SELECT 1; -- done` fails with `SQL code did not contain a statement`, where local SQLite runs it.

## D1 REST adapter

**No separate D1 limit.** [Cloudflare's API limits page](https://developers.cloudflare.com/fundamentals/api/reference/limits/) names the APIs with separate limits, and D1 is not one. [D1's limits page](https://developers.cloudflare.com/d1/platform/limits/) lists no request rate. This rests on the docs not listing one, and was not tested.

**No visible quota.** Measured on real D1, 2026-11: its responses carry no `Ratelimit` headers, despite Cloudflare's general docs describing them.

**Failed batches.** Measured on real D1, 2026-11: a failed `batch` rolled back its earlier statements, but the docs don't promise it, so the SQL interface treats batches as non-atomic. A 2,000 statement batch succeeded; nothing larger was tested.

## R2 adapter

**Recognizing error 10058 by message.** `R2Error` in `@cloudflare/workers-types` declares a `code`, but the binding's errors had none when tested in local workerd, 2026-11, on a real error 10020. So the adapter matches the `(10058)` that ends the message. Real R2 has not been tested, and a reworded message would turn a concurrent put into a failure.
