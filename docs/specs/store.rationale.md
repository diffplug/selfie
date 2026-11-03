# Store — Rationale

> Informative companion to [store.md](store.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Image identity

**Opaque only.** All 1,016 Chromium screenshots rendered so far, 2026-11, are 8-bit RGB PNGs with no alpha channel. They came from one app's Storybook through Playwright, without `omitBackground`. Taking RGB directly means a bulk copy, where taking RGBA cost about 6.7 ms per 1200×900 image to scan alpha and strip it, in a micro-benchmark of equivalent loops. Support for transparency could be added later without changing any existing hash, because an RGBA PAM has a different header.

## Image decoding

**Why so narrow.** All 746 real Chromium screenshots checked, from Linux and macOS at 1× and 2× scale, are 8-bit RGB holding only `IHDR`, `IDAT`, and `IEND`. PNG is only what Chromium hands over, so anything else is a sign that something changed, and refusing it keeps one set of pixels to one hash. All-255 RGBA stays because rendering environments are configurable. This can be widened later without changing any hash, since the hash covers decoded pixels.

**Why `sharp` decodes.** A PNG decoder of our own existed so that a Worker could verify uploads, since `sharp` can't run in one. A Worker no longer decodes ([sync's rationale](sync.rationale.md#what-a-store-takes)), and everything else that needs pixels is the CLI, which already has `sharp` for WebP. Every pixel of those 746 screenshots matched between the two decoders, and the suite pins 2 of them and 8 PngSuite files to hashes `sharp` computed, so no hash changed. Over those 746 in Node, mostly 1200×900, the median decode was about 2 ms for `sharp`, against 6.7 ms for our own.

**Why a check stays in front of it.** `sharp` is much less strict than the decoder it replaced, on files built for the purpose, 2026-11, with `sharp` 0.35.5:

| File | `sharp` alone |
|---|---|
| A color profile | Accepts, and changes the pixels |
| Real transparency | Accepts, with 4 channels |
| All-opaque RGBA | Accepts, with 4 channels |
| Palette, 16-bit, or interlaced | Accepts, same pixels |
| Grayscale | Accepts, as 3 channels |
| Extra chunks, bytes after `IEND`, or no `IEND` | Accepts, same pixels |
| Corrupt or cut-short image data | Refuses |

A color profile is why the chunk rule isn't only tidiness: it would change a hash with no error. It also ignores image data past the last row, even a megabyte for a 1×1, without inflating it all, and that can't change the pixels.

**A WebP's alpha bit.** Measured 2026-11: a half-transparent lossless WebP, with that bit cleared by hand, passes `checkImageFile`. `sharp` reads it as 3 opaque channels, and Chromium 153 draws half its pixels at alpha 128. So one hash can name two pictures. It isn't closed, since catching it takes a decoder that keeps alpha, Selfie's encoder writes from RGB so an honest client can't make one, and a client lying about this could as easily send any other picture. RFC 9649 says the bit "is a hint only and SHOULD NOT impact decoding".

**The pixel limit.** 100,000,000 is a judgment call.

## Storage

**Format in the bytes, not in a column.** PNG, WebP, and JPEG XL all open with a fixed signature, so reading the first bytes needs no schema change and can't drift from what's stored. A column would need a migration ([Open questions](store.md#open-questions)), and a suffix on the blob key would make `has` check every format.

**No migration of PAM blobs.** Before this change a blob held a PAM file. No store has held real images yet: the only data is test data, so nothing converts them.

**A row means the bytes exist.** Bytes are always written before the row, so a group already stored costs one SQL request and no blob calls. The cost is that putting an image again no longer repairs a blob lost some other way: `Store.getImage` still reports a row with no bytes as an error.

**First bytes, not strictly.** The store checks and then writes, so concurrent first puts can both write, and the blob ends as either. Making that strict would take a conditional put in every adapter, for no change in what the bytes decode to.

**Why WebP.** A lossless comparison over 434 screenshots at 1× and 2×, 2026-11, recommended it over keeping PNG and over JPEG XL. Its full report isn't in the repo. On dormouse's 541 stories rendered as whole pages, in the same comparison's terms:

| | 1× | 1.5× | 2× |
|---|---|---|---|
| PNG as written | 25.2 MB | 44.6 MB | 62.1 MB |
| WebP at `effort: 4` | 8.0 MB | 13.6 MB | 18.7 MB |
| Encoding, average per image | 28 ms | 52 ms | 83 ms |
| Decoding, average per image | 5 ms | 9 ms | 13 ms |

All 1,623 of those images came back from `sharp` with exactly the same pixels, in the simple `VP8L` form, with the alpha bit clear.

**What a review pays.** On those 541 stories at 1×, on one Mac, the store step of a review took about 20 s with every image new, writing 4 at a time, and about 6 s with every image already stored. It took about 36 s with every image new when writing one at a time. Blobs took 8.8 MB, against 25.2 MB of PNG.

**The fallback.** 16,384 on either side was refused by `sharp`, with 16,383 accepted. The tallest of those stories is 9,898, so it stays rare, but it's only a few lines since PNG decoding has to exist anyway for what Chromium writes.

**Encoding in the store.** The rule was once that the store never encodes. Encoding before `Store.putImages` would encode every image of every run, when nearly all of them are already stored, since only the store knows which are new. So it asks an injected codec, for added images only.

**`sharp`'s license.** `sharp` is Apache-2.0. Its prebuilt `@img/sharp-libvips-*` packages are LGPL-3.0-or-later, installed as separate npm packages and linked dynamically. That was read from their `package.json` files, and isn't legal advice.

## Built Storybooks

**Why by file, and why one list.** Storybook names most of its files by their content, so most of a built Storybook survives a rebuild. This repository's build is 10 MB in 65 files, and Dormouse's 568 stories are 12 MB in 390 files, both measured 2026-11. Dormouse's first keep added about 3.4 s to a record. A row per file would write that many rows for every built Storybook, and take a request for every file a page loads. One list is one blob, read once.

**Why the first list stays.** A built Storybook's hash ignores what can't change a pixel (`docs/specs/render.md`), so two builds with one hash can differ in `project.json`. Either answer is fine, and keeping the first means a kept built Storybook never changes, which a browser's cache relies on.

## Adapters

**Statement size limit.** Measured on real D1, 2026-11: a 100,000 byte statement runs, and 100,001 fails with `SQLITE_TOOBIG`. Nothing checked this locally before, so an oversized query would only have failed in the cloud.

**Comments after the closing semicolon.** Measured on real D1, 2026-11: `SELECT 1; -- done` fails with `SQL code did not contain a statement`, where local SQLite runs it.

## D1 REST adapter

**No separate D1 limit.** [Cloudflare's API limits page](https://developers.cloudflare.com/fundamentals/api/reference/limits/) names the APIs with separate limits, and D1 is not one. [D1's limits page](https://developers.cloudflare.com/d1/platform/limits/) lists no request rate. This rests on the docs not listing one, and was not tested.

**No visible quota.** Measured on real D1, 2026-11: its responses carry no `Ratelimit` headers, despite Cloudflare's general docs describing them.

**Failed batches.** Measured on real D1, 2026-11: a failed `batch` rolled back its earlier statements, but the docs don't promise it, so the SQL interface treats batches as non-atomic. A 2,000 statement batch succeeded; nothing larger was tested.

## R2 adapter

**Recognizing error 10058 by message.** `R2Error` in `@cloudflare/workers-types` declares a `code`, but the binding's errors had none when tested in local workerd, 2026-11, on a real error 10020. So the adapter matches the `(10058)` that ends the message. Real R2 has not been tested, and a reworded message would turn a concurrent put into a failure.
