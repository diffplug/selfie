# Store

> Status: design — nothing here is implemented yet.
>
> - See `docs/specs/glossary.md` for image, image hash, image key, and store.
> - Owns image identity, image keys, and hash collisions. The build order belongs to `docs/specs/system.md`.

## Future

**Scope: store**

### Image identity

- **Must compute the image hash over a complete PAM file, header included, with one canonical header form**, so identical bytes at 100×200 and 200×100 are different images, and one set of pixels has one hash.
- **Must produce the same hash for the same pixels regardless of source file encoding**, so re-encoding a PNG does not create a new image.
- **Must exchange images between stores by image hash, never by image key.**

### Image keys

- **Must assign the image's positive key when its hash truncated to the safe positive integer range is unclaimed.** The range is 1 to 2^53 − 1.
- **Must assign the next monotonic negative key, starting at −1, when the truncated value is claimed by a different image or is 0.** A negative key is what marks a collision; there is no separate collision table.
- **Must return the existing key when the same image is inserted again**, including an image holding a negative key.
- **Must compare the full image hash on every lookup**, so a colliding image never resolves to another image's key.
- **Never reuse or reassign an image key within a store.**
- **Must insert each image in a single SQL statement, with no read-then-write across statements**, so concurrent inserts of the same or colliding images leave one key per image, without relying on batch atomicity.

### Storage

- **Must keep image bytes in blob storage, never in SQL**, since D1 caps a row at 2 MB.
- **Must key cloud blobs by project and image hash**, never by image key, and never shared across projects.
- **Must write image bytes before the metadata row that refers to them**, since blob storage and SQL share no transaction: a failure can orphan bytes but never leave a row without bytes.
- **Must test collisions two ways:** an injected hash function for the logic, and a committed pair of real images whose hashes collide at 53 bits.

### Adapters

The store core runs unchanged locally and in the cloud, the way Hono does for HTTP. It reaches the platform only through two async interfaces:

| Interface | Operations | Adapters |
|---|---|---|
| SQL | Run one SQLite-dialect statement, or several in one request with no atomicity across them | Local SQLite; D1 REST API |
| Blob | Put, get, and check for bytes by key | Filesystem; R2 binding |

- **Never import a platform API into the store core**, such as `node:fs` or a Cloudflare type. Only adapters may, and the core uses Web-standard types.
- **Must limit the SQL interface to what every adapter supports**, so a statement that works locally also works on D1. It offers no transactions.
- **Must enforce the 100 bound parameter limit in the SQL interface for every adapter**, so an oversized query fails locally rather than only on D1.
- **Must write SQL that gives the same result whether a parameter arrives as a number or a string**, since the D1 REST API documents its parameters as strings. Integer parameters are wrapped in `CAST(? AS INTEGER)`.
- **Must make blob put idempotent**, so a retry or a concurrent put of the same image is safe.
- **Must run one contract test suite against every adapter**, including concurrent inserts, so a new adapter is correct when it passes.

Neon stays outside these interfaces: accounts are Postgres and only ever in the cloud (`docs/specs/system.md` → Cloud data).

#### D1 REST adapter

- **Must reach a project's D1 through the D1 REST API.** Moving to a Worker binding replaces only this adapter (`docs/specs/system.md` → `platforms-upgrade`).
- **Must combine work into as few REST requests as possible**, since every project shares one limit of 1,200 Cloudflare API requests per 5 minutes per user.
- **Must back off on HTTP 429**, since exceeding that limit blocks all API calls for 5 minutes.

#### R2 adapter

- **Must access R2 through a Worker binding, never the Cloudflare API**, so image traffic doesn't count against that limit.

### Open questions

- **D1 REST rate limit.** Whether D1 has its own limit on top of the global Cloudflare API limit.
- **Schema migrations.** How a schema change reaches every project database, and how the app treats a database still on the older schema.
- **Stored encoding.** Whether R2 holds the hashed PAM or a compressed form that decodes back to it.
