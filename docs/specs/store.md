# Store

> Status: partly built — the store core and its local SQLite and filesystem adapters exist. The D1 REST adapter, the R2 adapter, and image decoding do not; see `## Future`.
>
> - See `docs/specs/glossary.md` for image, image hash, image key, and store.
> - Owns image identity, image keys, and hash collisions. The build order belongs to `docs/specs/system.md`.

## Image identity

Source of truth: `store/src/core/pam.ts`, `store/src/core/image-hash.ts`.

- **Must compute the image hash over a complete PAM file, header included, with one canonical header form**, so identical bytes at 100×200 and 200×100 are different images, and one set of pixels has one hash. The form is `P7\nWIDTH <w>\nHEIGHT <h>\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`, with `<w>` and `<h>` as plain decimals, followed by the pixels as RGBA row by row. The hash is SHA256, written as lowercase hex.
- **Must take decoded RGBA pixels with a width and height, never an encoded file**, so the source encoding cannot reach the hash. Reserved: decoding is [Image decoding](#image-decoding).
- **Must exchange images between stores by image hash, never by image key.** The store's API takes and returns image hashes; the key it returns is only for that store's own rows.

## Image keys

Source of truth: `store/src/core/store.ts`.

- **Must assign the image's positive key when its hash truncated to the safe positive integer range is unclaimed.** The range is 1 to 2^53 − 1, and the truncated value is the hash's first 53 bits, read big-endian.
- **Must assign the next monotonic negative key, starting at −1, when the truncated value is claimed by a different image or is 0.** A negative key is what marks a collision; there is no separate collision table.
- **Must return the existing key when the same image is inserted again**, including an image holding a negative key.
- **Must compare the full image hash on every lookup**, so a colliding image never resolves to another image's key.
- **Never reuse or reassign an image key within a store.** The store has no delete. The next negative key derives from the lowest key present, so a delete must not let that key be reused.
- **Must insert each image in a single SQL statement, with no read-then-write across statements**, so concurrent inserts of the same or colliding images leave one key per image, without relying on batch atomicity.

## Storage

Source of truth: `store/src/core/store.ts`; tests in `store/test/store.test.ts` and `store/test/collision-fixture.test.ts`.

- **Must keep image bytes in blob storage, never in SQL**, since D1 caps a row at 2 MB. A blob holds the image's complete PAM file.
- **Must key blobs by image hash, never by image key.** The key is `images/<image hash>`. Reserved: cloud blobs add the project, per [R2 adapter](#r2-adapter).
- **Must write image bytes before the metadata row that refers to them**, since blob storage and SQL share no transaction: a failure can orphan bytes but never leave a row without bytes.
- **Must treat bytes with no row as not stored**, so an orphan is never served as an image.
- **Must test collisions two ways:** an injected hash function for the logic, and a committed pair of real images whose hashes collide at 53 bits. The test recomputes both hashes from the committed images. `pnpm find-collision` regenerates the pair, separately from the test run.

## Adapters

Source of truth: `store/src/core/sql.ts`, `store/src/core/blob.ts`, `store/src/adapters/`; the contract suite is `store/test/contract/`.

The store core runs unchanged locally and in the cloud, the way Hono does for HTTP. It reaches the platform only through two async interfaces:

| Interface | Operations | Adapters |
|---|---|---|
| SQL | Run one SQLite-dialect statement, or several in one request with no atomicity across them | Local SQLite. Reserved: [D1 REST adapter](#d1-rest-adapter) |
| Blob | Put, get, and check for bytes by key | Filesystem. Reserved: [R2 adapter](#r2-adapter) |

- **Never import a platform API into the store core**, such as `node:fs` or a Cloudflare type. Only adapters may, and the core uses Web-standard types. Typecheck enforces this: `store/src/core` compiles with no Node types.
- **Must limit the SQL interface to what every adapter supports**, so a statement that works locally also works on D1. It offers no transactions, and refuses transaction and `ATTACH` statements.
- **Must check every statement and blob key in the interfaces, above the adapters**, so no adapter can skip a check. An adapter only executes, and the store accepts only the checked `Sql` and `Blobs`.
- **Must enforce the 100 bound parameter limit in the SQL interface for every adapter**, so an oversized query fails locally rather than only on D1. A numbered parameter counts as SQLite counts it: `?101` needs 101 parameters, and a reused `?1` counts once.
- **Must use only numbered or anonymous parameters, never named ones**, since D1 does not support named parameters.
- **Must bind exactly the parameters a statement uses, each a string or a finite number**, since SQLite silently binds a missing parameter to NULL.
- **Must run one statement at a time**, since `node:sqlite` silently ignores everything after the first.
- **Must write SQL that gives the same result whether a parameter arrives as a number or a string**, since the D1 REST API documents its parameters as strings. Integer parameters are wrapped in `CAST(?1 AS INTEGER)`.
- **Must make blob put idempotent**, so a retry or a concurrent put of the same image is safe.
- **Must make a blob complete at its key or absent from it, never partial**, including after a crash mid-write.
- **Must keep blob keys to lowercase letters, digits, `.`, `_`, `-`, and `/` separators, with each segment starting with a letter or digit**, so every adapter can hold every key and none can escape its directory.
- **Must run one contract test suite against every adapter**, including concurrent inserts through separate connections, so a new adapter is correct when it passes. A new adapter supplies a factory. Its concurrent inserts must really overlap: an adapter whose driver blocks its thread, as `node:sqlite` does, supplies separate threads.

Neon stays outside these interfaces: accounts are Postgres and only ever in the cloud (`docs/specs/system.md` → Cloud data).

## Future

**Scope: store**

### Image decoding

- **Must decode every source encoding of the same pixels to the same 8-bit RGBA**, so re-encoding a PNG does not create a new image.

### D1 REST adapter

- **Must reach a project's D1 through the D1 REST API.** Moving to a Worker binding replaces only this adapter (`docs/specs/system.md` → `platforms-upgrade`).
- **Must combine work into as few REST requests as possible**, since every project shares one limit of 1,200 Cloudflare API requests per 5 minutes per user.
- **Must back off on HTTP 429**, since exceeding that limit blocks all API calls for 5 minutes.

### R2 adapter

- **Must access R2 through a Worker binding, never the Cloudflare API**, so image traffic doesn't count against that limit.
- **Must key cloud blobs by project and image hash**, never by image key, and never shared across projects.

### Open questions

- **D1 REST rate limit.** Whether D1 has its own limit on top of the global Cloudflare API limit.
- **Schema migrations.** How a schema change reaches every project database, and how the app treats a database still on the older schema.
- **Stored encoding.** Whether R2 holds the hashed PAM or a compressed form that decodes back to it.
