# Store

> Status: built — the store core, image decoding, WebP storage with PNG as its fallback, its local SQLite and filesystem adapters, and the D1 REST and R2 adapters exist. A question stays open, and a Worker can't yet read a WebP; see `## Future`.
>
> - See `docs/specs/glossary.md` for image, image hash, image key, and store.
> - Owns image identity, image decoding, image keys, and hash collisions. The build order belongs to `docs/specs/system.md`. Snapshots, runs, and goldens belong to `docs/specs/snapshots.md`.

## Image identity

Source of truth: `store/src/core/pam.ts`, `store/src/core/image-hash.ts`.

- **Must handle only fully opaque images. Transparency is never allowed.** An image is 8-bit RGB with no alpha channel in every interface, hash, and stored form (rationale).
- **Must compute the image hash over a complete PAM file, header included, with one canonical header form**, so identical bytes at 100×200 and 200×100 are different images, and one set of pixels has one hash. The form is `P7\nWIDTH <w>\nHEIGHT <h>\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n`, with `<w>` and `<h>` as plain decimals, followed by the pixels as RGB row by row. The hash is SHA256, written as lowercase hex.
- **Must hash decoded RGB pixels with a width and height, never an encoded file**, so the source encoding cannot reach the hash. A file is decoded first, per [Image decoding](#image-decoding).
- **Must exchange images between stores by image hash, never by image key.** The store's API takes and returns image hashes; the key it returns is only for that store's own rows.

## Image decoding

Source of truth: `store/src/core/image-file.ts`; the contract suite is `store/test/contract/png-contract.ts`, which `store/test/png.test.ts` runs in Node and `store/test/workerd/png.workerd.test.ts` runs in workerd.

- **Must accept exactly a non-interlaced 8-bit PNG in RGB, or in RGBA whose every alpha is 255, which is dropped.** Every source encoding of the same pixels decodes to the same RGB, where an encoding means row filters, compression, and how `IDAT` chunks split the data.
- **Must refuse everything else with an `ImageDecodeError` that names what it refused, and never flatten alpha**, since flattening would give different images one hash. That includes any other alpha, grayscale, palette, 16-bit, below 8 bits, and interlaced (rationale).
- **Must allow only `IHDR`, then `IDAT`, then `IEND`, with nothing after, and refuse any other chunk**, even harmless metadata.
- **Must refuse a corrupt file, never repair it**: a failed checksum on any chunk or the zlib stream, an invalid filter type, or image data that doesn't inflate to exactly the expected length.
- **Must refuse a PNG over 100,000,000 pixels before allocating for it, and stop inflating as soon as the data runs past the expected length**, so a small file can't exhaust memory.
- **Must accept a WebP only in its simple lossless form:** `RIFF`, `WEBP`, then one `VP8L` chunk with nothing after, version 0, and the alpha bit clear. It refuses a lossy or extended WebP, including any metadata, and any transparency. It checks all this and the 100,000,000 pixel limit in the header, before anything decodes the body.
- **Must decode a WebP's body through an injected `WebpCodec`, and check the answer against the header**, since no one library runs on every platform. With no codec, a WebP is refused. `sharpWebp` in `store/src/adapters/sharp-webp.ts` is the Node one.
- **Must run PNG decoding and the WebP header check unchanged in Node and in Workers**, on Web-standard APIs and no library (rationale), since `Store` decodes on both. The whole contract runs in workerd as part of `pnpm test`.

## Image keys

Source of truth: `store/src/core/store.ts`.

- **Must assign the image's positive key when its hash truncated to the safe positive integer range is unclaimed.** The range is 1 to 2^53 − 1, and the truncated value is the hash's first 53 bits, read big-endian.
- **Must assign the next monotonic negative key, starting at −1, when the truncated value is claimed by a different image or is 0.** A negative key is what marks a collision; there is no separate collision table.
- **Must return the existing key when the same image is inserted again**, including an image holding a negative key.
- **Must compare the full image hash on every lookup**, so a colliding image never resolves to another image's key.
- **Never reuse or reassign an image key within a store.** The store has no delete. The next negative key derives from the lowest key present, so a delete must not let that key be reused.
- **Must insert each image in a single SQL statement, with no read-then-write across statements**, so concurrent inserts of the same or colliding images leave one key per image, without relying on batch atomicity.

## Storage

Source of truth: `store/src/core/store.ts`, `store/src/core/image-file.ts`; tests in `store/test/store.test.ts` and `store/test/collision-fixture.test.ts`.

- **Must keep image bytes in blob storage, never in SQL**, since D1 caps a row at 2 MB. A blob holds an image file, which `Store.getImage` returns ready to serve, and `Store.getPixels` decodes.
- **Must keep the file format behind `store/src/core/image-file.ts`, and never let it reach the hash or a key**, since compressed bytes differ between tools and the format may change.
- **Must take a file's hash from decoding it, and with a `WebpCodec`, keep a new PNG as a lossless WebP** (rationale). Anything else stays as the exact bytes given: a WebP it's handed, and every file in a store with no codec.
- **Must keep a PNG whose width or height is over 16,383**, WebP's limit, so an image of any size the decoder accepts can be stored.
- **Must decode the WebP and compare its hash before storing it, and store nothing if they differ**, so what's stored always decodes to the pixels that were hashed.
- **Must encode only an image not yet stored**, so an unchanged image costs no encoding. **May write at most 4 images at once within a group**, each holding a whole image while it encodes.
- **Must keep the first bytes stored for a hash.** A later encoding of the same pixels changes nothing, and neither does a retry that finds an orphan. Concurrent first puts may leave either one, and both decode to the same pixels.
- **Must make a blob state its own format in its first bytes**, so a store can hold more than one format, with no schema change. `imageMediaType` reads it.
- **Must key blobs by image hash, never by image key.** The key is `images/<image hash>`; the [R2 adapter](#r2-adapter) adds the project.
- **Must write image bytes before the metadata row that refers to them**, since blob storage and SQL share no transaction: a failure can orphan bytes but never leave a row without bytes.
- **Must treat bytes with no row as not stored**, so an orphan is never served as an image.
- **Must say which of a set of images it lacks, with `Store.missingImages`, in one SQL request for up to 5,000**, so another store need only send those (`docs/specs/sync.md`).
- **Must refuse, before storing anything, bytes that aren't the image they're sent as**, when `putImage` is given the hash another store knows it by.
- **Must offer a bulk put that groups image inserts, at most 100 per SQL request**, so storing many images doesn't spend one API request each. `Store.putImages` writes each group's bytes before its rows.
- **Must look up each group's hashes in one statement, and do nothing more for a hash with a row**: no blob call and no insert, since bytes are always written first. Everything else inserts as [Image keys](#image-keys) says, so a concurrent insert stays safe.
- **Must test collisions two ways:** an injected hash function for the logic, and a committed pair of real images whose hashes collide at 53 bits. The test recomputes both hashes from the committed images. `pnpm find-collision` regenerates the pair, separately from the test run.

## Adapters

Source of truth: `store/src/core/sql.ts`, `store/src/core/blob.ts`, `store/src/adapters/`; the contract suite is `store/test/contract/`.

The store core runs unchanged locally and in the cloud, the way Hono does for HTTP. It reaches the platform only through two async interfaces:

| Interface | Operations | Adapters |
|---|---|---|
| SQL | Run one SQLite-dialect statement, or several in one request with no atomicity across them | Local SQLite, [D1 REST](#d1-rest-adapter) |
| Blob | Put, get, and check for bytes by key | Filesystem, [R2](#r2-adapter) |

- **Never import a platform API into the store core**, such as `node:fs` or a Cloudflare type. Only adapters may, and the core uses Web-standard types. Typecheck enforces this: `store/src/core` compiles with no Node types.
- **Must limit the SQL interface to what every adapter supports**, so a statement that works locally also works on D1. It offers no transactions, and refuses transaction and `ATTACH` statements.
- **Must check every statement and blob key in the interfaces, above the adapters**, so no adapter can skip a check. An adapter only executes, and the store accepts only the checked `Sql` and `Blobs`.
- **Must enforce the 100 bound parameter limit in the SQL interface for every adapter**, so an oversized query fails locally rather than only on D1. A numbered parameter counts as SQLite counts it: `?101` needs 101 parameters, and a reused `?1` counts once.
- **Must enforce the 100,000 byte statement limit in the SQL interface for every adapter**, for the same reason (rationale).
- **Must use only numbered or anonymous parameters, never named ones**, since D1 does not support named parameters.
- **Must bind exactly the parameters a statement uses, each a string or a finite number**, since SQLite silently binds a missing parameter to NULL.
- **Must run one statement at a time**, since `node:sqlite` silently ignores everything after the first.
- **Never allow a comment after a statement's closing semicolon**, since real D1 fails on it where local SQLite runs it (rationale). A comment before the semicolon is fine on both.
- **Must mark a statement idempotent only if running it again, after it may already have run, returns the same rows and changes nothing further.** An adapter may resend a statement after a failure that leaves its outcome unknown only if it is so marked. Everything the store sends is: the image insert returns the key the first run assigned, per [Image keys](#image-keys).
- **Must write SQL that gives the same result whether a parameter arrives as a number or a string**, since the D1 REST API documents its parameters as strings. Integer parameters are wrapped in `CAST(?1 AS INTEGER)`.
- **Must make blob put idempotent**, so a retry or a concurrent put of the same image is safe, whichever encoding each one holds.
- **Must make a blob complete at its key or absent from it, never partial**, including after a crash mid-write.
- **Must keep blob keys to lowercase letters, digits, `.`, `_`, `-`, and `/` separators, with each segment starting with a letter or digit**, so every adapter can hold every key and none can escape its directory.
- **Must run one contract test suite against every adapter**, including concurrent inserts through separate connections, so a new adapter is correct when it passes. A new adapter supplies a factory. Its concurrent inserts must really overlap: an adapter whose driver blocks its thread, as `node:sqlite` does, supplies separate threads. An adapter metered per request may group each connection's inserts into batches, and must then also show single inserts from separate connections interleaving on the database.

Neon stays outside these interfaces: accounts are Postgres and only ever in the cloud (`docs/specs/system.md` → Cloud data).

## D1 REST adapter

Source of truth: `store/src/adapters/d1-rest.ts`; tests in `store/test/d1-rest.test.ts` and, against real D1, `store/test/d1-rest.real.test.ts` and `store/test/workerd/d1.real.workerd.test.ts`.

- **Must reach a project's D1 through the D1 REST API, with Web-standard APIs only**, so it runs in a Worker and in Node. Typecheck enforces this as it does for the core, and `store/test/workerd/d1.real.workerd.test.ts` runs it inside workerd. Moving to a Worker binding replaces only this adapter (`docs/specs/system.md` → `platforms-upgrade`).
- **Must send one `execute` as one REST request**, since every project shares one limit of 1,200 Cloudflare API requests per 5 minutes per user. No documented D1 limit sits on top of it, and a client cannot see what remains of it (rationale).
- **Must back off and resend on HTTP 429, whatever the statements are**, since exceeding the limit blocks all API calls for 5 minutes and a 429 means the request never ran. It waits as long as `Retry-After` asks, or else a jittered doubling delay.
- **Never wait out a block.** A 429 asking for longer than the longest allowed wait fails at once, reporting the wait.
- **Must resend after a failure with an unknown outcome only if every statement is marked idempotent**, since the request may have committed with only its response lost. A network failure, a timeout, a 5xx, an unreadable response, and the errors [D1's docs](https://developers.cloudflare.com/d1/observability/debug-d1/) say to retry all count as unknown. If it cannot resend, it fails saying the statements may have taken effect.
- **Must fail at once on any other failure**, such as a SQL error or a bad token, with D1's message.
- **Must bound every retry and every attempt**: a limit on attempts, a limit on any one wait, and a timeout on each request.
- **Never put the token in an error or in anything a log could print.**
- **Must keep tests against real D1 opt-in**, so `pnpm test` runs offline with no credentials. `pnpm test:d1` runs the contract in Node, and `docs/specs/snapshots.md`'s after it, and sends about 495 requests against the shared limit, so never loop it. `pnpm test:d1:snapshots`, in `store/`, runs only the second, at about 90. `pnpm test:d1:workerd` runs inside workerd, with the whole store over this adapter and the [R2 adapter](#r2-adapter), and stops at a budget of 30. Run one at a time, of either, since all runs share one database.

## R2 adapter

Source of truth: `store/src/adapters/r2.ts`; tests in `store/test/workerd/r2.workerd.test.ts`.

- **Must access R2 through a Worker binding, never the Cloudflare API**, so image traffic doesn't count against the Cloudflare API limit ([D1 REST adapter](#d1-rest-adapter)). The adapter states the binding's shape itself, so nothing imports a Cloudflare type.
- **Must key cloud blobs by project and image hash**, never by image key, and never shared across projects. The object key is `projects/<project>/<blob key>`, so the same image in two projects is two objects.
- **Must refuse a project identifier that isn't one blob key segment**, as [Adapters](#adapters) defines a segment, so it holds no `/` and no project's prefix can lie inside another's. A blob key can't climb out of its prefix, by the same rule.
- **Must give a project an identifier that never passes to another project**, since the identifier is all that separates their objects. Reserved: a project's identifier is its GitHub repository ID (`docs/specs/access.md` → GitHub App).
- **Must treat R2's per-key write limit as a concurrent put, not a failure.** R2 allows [one write per second per key](https://developers.cloudflare.com/r2/platform/limits/) and throws error 10058 for more. If a blob is then at the key, the put is done, since everything put at a key decodes to the same pixels. If not, it resends after a jittered doubling delay, a bounded number of times, then fails with R2's error. Any other error fails at once.
- **Must run the blob contract against the real binding inside workerd, never a mock or a Node-side proxy**, as part of `pnpm test`, since workerd's local R2 needs no network or credentials. Local R2 does not enforce the per-key write limit, so tests raise error 10058 over the binding. No test has run against real R2.

## Future

**Scope: store**

### A Worker reading a WebP

`Store` in a Worker can't read a WebP until it has a `WebpCodec` of its own, since `sharpWebp` is native. `@jsquash/webp` decoded real images correctly in local `workerd` (rationale). Two things to settle with **Scope: cloud-deploy**, defined in `docs/specs/system.md` → Build order:

- Hashing needs an image's raw pixels in memory, in either format, so a very tall page at 2× likely doesn't fit a Worker's 128 MB. Something must verify those another way, or refuse them.
- A Worker has no encoder, so whatever uploads must send WebP itself.

### Open questions

- **Schema migrations.** How a schema change reaches every project database, and how the app treats a database still on the older schema. Until then a change may only add tables and indexes, through `initStoreSchema`, with one exception made before any project database existed (`docs/specs/snapshots.md` → Schema).
