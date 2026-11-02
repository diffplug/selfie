# Store — Rationale

> Informative companion to [store.md](store.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Adapters

**Statement size limit.** Measured on real D1, 2026-11: a 100,000 byte statement runs, and 100,001 fails with `SQLITE_TOOBIG`. Nothing checked this locally before, so an oversized query would only have failed in the cloud.

**Comments after the closing semicolon.** Measured on real D1, 2026-11: `SELECT 1; -- done` fails with `SQL code did not contain a statement`, where local SQLite runs it.

## D1 REST adapter

**No separate D1 limit.** [Cloudflare's API limits page](https://developers.cloudflare.com/fundamentals/api/reference/limits/) names the APIs with separate limits, and D1 is not one. [D1's limits page](https://developers.cloudflare.com/d1/platform/limits/) lists no request rate. This rests on the docs not listing one, and was not tested.

**No visible quota.** Measured on real D1, 2026-11: its responses carry no `Ratelimit` headers, despite Cloudflare's general docs describing them.

**Failed batches.** Measured on real D1, 2026-11: a failed `batch` rolled back its earlier statements, but the docs don't promise it, so the SQL interface treats batches as non-atomic. A 2,000 statement batch succeeded; nothing larger was tested.

## R2 adapter

**Recognizing error 10058 by message.** `R2Error` in `@cloudflare/workers-types` declares a `code`, but the binding's errors had none when tested in local workerd, 2026-11, on a real error 10020. So the adapter matches the `(10058)` that ends the message. Real R2 has not been tested, and a reworded message would turn a concurrent put into a failure.
