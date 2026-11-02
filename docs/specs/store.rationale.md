# Store — Rationale

> Informative companion to [store.md](store.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Image identity

**Opaque only.** All 1,016 Chromium screenshots captured so far, 2026-11, are 8-bit RGB PNGs with no alpha channel. They came from one app's Storybook through Playwright, without `omitBackground`. Taking RGB directly means a bulk copy, where taking RGBA cost about 6.7 ms per 1200×900 image to scan alpha and strip it, in a micro-benchmark of equivalent loops. Support for transparency could be added later without changing any existing hash, because an RGBA PAM has a different header.

## Image decoding

**No PNG library.** `store/src/core/png.ts` is about 500 lines over the platform's own `DecompressionStream` and `CompressionStream`, and adds no dependency. Every candidate was weighed against what the store must do: refuse what isn't exact, and run in Node and in Workers.

| Option | License | Last release | Why not |
|---|---|---|---|
| `fast-png` 8.0.0 | MIT | 2025-12 | Runs everywhere, and decoded all 746 real screenshots exactly, but is wrong on the rest (below), and its API exposes neither the inflate nor the chunks |
| `sharp` 0.35.5 | Apache-2.0, shipping LGPL-3.0-or-later libvips | current | The fastest, at 2.3 ms against 7.7 ms, but native, so it can't be in the core or run in a Worker. Asked for 8-bit output, it reduces 16-bit samples silently. Its license would also need weighing against this repo's FSL-1.1-MIT |
| `@jsquash/png` 3.1.1 | Apache-2.0 | 2025-05 | The strongest alternative: WASM that decoded exactly in workerd in the benchmark, with a 16-bit mode that could support the exactness rule. But a Worker and Node must each load its 181 KB of WASM their own way, which the core can't express, so it would need injecting. It would still need a chunk scan for the color and animation refusals, and its handling of malformed files was not tested |
| `pngjs` 7.0.0 | MIT | 2023-02 | Node streams and `node:zlib`, unmaintained |

Measured on `fast-png` 8.0.0, with `checkCrc: true` except where noted, 2026-11:

- Interlaced below 8 bits throws, on PngSuite's `basi3p01`, `basi3p02`, and `basi3p04`: its Adam7 reads whole bytes per pixel.
- A row cut short inside a valid zlib stream decodes silently, with the missing samples as zero. A 2×2 image with 11 of its 14 bytes returned `9,9,9,9,9,9,9,9,9,0,0,0`.
- 256 MiB of image data in a 261 KB file declaring 1×1 decodes silently in 678 ms. The store refuses it in 6 ms.
- An animated file decodes silently as its first frame.
- With its default `checkCrc: false`, a flipped image byte decodes silently to other pixels.

**How the decoder was checked.** Against `sharp`, outside the test suite, 2026-11:

- All 176 files of [PngSuite](http://www.schaik.com/pngsuite/) with their color chunks removed: 118 decode to the same pixels, 44 are refused for alpha or inexact 16-bit samples, and all 14 of its corrupt files are refused. None disagree.
- All 746 real Chromium screenshots on hand, from Linux and macOS at 1× and 2× scale: every pixel matches, and none is refused.

The test suite pins 29 PngSuite files and two screenshots to hashes `sharp` computed, so the expected values don't come from this decoder. Its other test files come from `store/test/support/png-builder.ts`, which shares no code with it.

**Speed.** Over those 746 screenshots in Node, mostly 1200×900, the median decode was 7.7 ms (p95 27 ms), against `fast-png` at 10.3 ms and `sharp` at 2.3 ms. Inside local workerd, two 1200×900 screenshots took 8 to 9 ms, a figure that includes one R2 call, and no test has run on a real Worker.

**Encoding.** Every row uses filter type 0, since on this corpus the benchmark's `sharp` runs with no filter gave smaller files than adaptive filtering, at compression level 6: 0.95 against 1.08 of Playwright's size. Over a sample of 149 screenshots, `encodePng` took a median of 9.1 ms and came to 0.90 of Chromium's size, against `fast-png`'s 32 ms and 0.91. The compression level is whatever the platform's `CompressionStream` uses, so bytes may differ across platforms, which nothing relies on.

**Exact 16-bit samples.** The PNG spec scales 8 bits to 16 by 257, so a sample with matching bytes is exactly that 8-bit value. A library rounding any other sample to 8 bits would give different images one hash.

**Refusing color chunks.** All 746 screenshots above hold only `IHDR`, `IDAT`, and `IEND`, so this refuses nothing Selfie renders. Accepting them would let one hash look different depending on which encoding was stored first, since the first stays. Refusing can be relaxed later without changing any hash, where accepting couldn't be undone. The cost is that a file tagged by another tool, such as ImageMagick by default or a macOS screenshot, needs its tags stripped first.

**The pixel limit.** 100,000,000 pixels is a judgment call, about twice an imagined 2560×20,000 full-page screenshot. The largest on hand is 4,320,000. A Worker's 128 MB can't hold an image anywhere near the limit, so it protects Node, and what a Worker does near its memory limit was not tested.

**Where decoding runs.** Inside a Worker for any upload through `Store`, since taking the hash from the decoded file is what guarantees bytes match their hash. Serving doesn't decode, since `Store.getImage` returns the stored file. No cloud flow encodes: a client uploads what Chromium wrote. `encodePng` runs in workerd only because the contract does. The benchmark found encoding inside a Worker unsafe at 2× scale, on WASM WebP and JPEG XL encoders, so nothing should come to rely on encoding there. `encodePng` wasn't part of that test.

## Storage

**Format in the bytes, not in a column.** PNG, WebP, and JPEG XL all open with a fixed signature, so reading the first bytes needs no schema change and can't drift from what's stored. A column would need a migration ([Open questions](store.md#open-questions)), and a suffix on the blob key would make `has` check every format.

**No migration of PAM blobs.** Before this change a blob held a PAM file. No store has held real images yet: the only data is test data, so nothing converts them.

**First bytes, not strictly.** The store checks and then writes, so concurrent first puts can both write, and the blob ends as either. Making that strict would take a conditional put in every adapter, for no change in what the bytes decode to.

## Stored encoding

Evidence for the open question, from a lossless comparison over 434 screenshots at 1× and 2×, 2026-11. Its full report isn't in the repo.

- Storing Playwright's PNG as it is costs no encoding time, at about 508 MB per 10,000 images.
- Lossless WebP through `sharp`, at `webp({ lossless: true, effort: 4 })`, is about 3× smaller and adds about 18 ms per 1200×900 image. It is the comparison's recommendation.
- A switch would mean an encoder where blobs are written, and a signature in `imageMediaType`. `sharp` is native, so it couldn't sit in the core, and would have to run on the machine rendering. PNG input stays, since that's what Chromium writes, and the hash wouldn't change.

## Adapters

**Statement size limit.** Measured on real D1, 2026-11: a 100,000 byte statement runs, and 100,001 fails with `SQLITE_TOOBIG`. Nothing checked this locally before, so an oversized query would only have failed in the cloud.

**Comments after the closing semicolon.** Measured on real D1, 2026-11: `SELECT 1; -- done` fails with `SQL code did not contain a statement`, where local SQLite runs it.

## D1 REST adapter

**No separate D1 limit.** [Cloudflare's API limits page](https://developers.cloudflare.com/fundamentals/api/reference/limits/) names the APIs with separate limits, and D1 is not one. [D1's limits page](https://developers.cloudflare.com/d1/platform/limits/) lists no request rate. This rests on the docs not listing one, and was not tested.

**No visible quota.** Measured on real D1, 2026-11: its responses carry no `Ratelimit` headers, despite Cloudflare's general docs describing them.

**Failed batches.** Measured on real D1, 2026-11: a failed `batch` rolled back its earlier statements, but the docs don't promise it, so the SQL interface treats batches as non-atomic. A 2,000 statement batch succeeded; nothing larger was tested.

## R2 adapter

**Recognizing error 10058 by message.** `R2Error` in `@cloudflare/workers-types` declares a `code`, but the binding's errors had none when tested in local workerd, 2026-11, on a real error 10020. So the adapter matches the `(10058)` that ends the message. Real R2 has not been tested, and a reworded message would turn a concurrent put into a failure.
