# System

> Status: design — nothing here is implemented yet.
>
> - See `docs/specs/glossary.md` for vocabulary.
> - Owns the staged build order and the behavior spanning the local app and the cloud. Image storage belongs to `docs/specs/store.md`.

## Future

### Opaque images only

Selfie is for fully opaque images, and transparency is never allowed: `docs/specs/store.md` → Image identity owns the rule, and `docs/specs/store.md` → Image decoding what happens to an image with alpha.

### Approvals

- **Must not make a user re-approve at push a snapshot change they already approved locally.** A user can approve changes on an unpushed PR, and those approvals carry through the push. The mechanism is undecided.

### Cloud data

| Data | Lives in |
|---|---|
| User accounts, and which D1 database belongs to each project | Neon Postgres |
| A project's snapshot metadata | That project's own D1 database |
| Image bytes | R2 |

- **Never put snapshot metadata in Neon or account data in a project's D1.**

### Build order

**Scope: rendering-check** — Render one Storybook twice on a Mac and on Linux CI, and compare image hashes. The result decides whether goldens need to be per-environment, which changes the snapshot name.

**Scope: store** — `docs/specs/store.md`.

**Scope: cli-review** — `selfie review` records snapshots locally and outputs JSON with image paths, so an agent can use the loop without a UI.

**Scope: local-review** — A review UI with approval, built as a Hono app running locally. The UI uses GitHub Primer.

**Scope: cloud-deploy** — The same Hono app deployed at `hackathon.selfie.dev`, with accounts in Neon through pgstencil and Hyperdrive, per-project D1, R2, and auth ([Cloud data](#cloud-data)).

**Scope: sync** — Push and pull between stores, and `find-baseline`. Local approvals carry through here ([Approvals](#approvals)).

**Scope: trust** — The cloud accepts local results without re-rendering.

**Scope: change-grouping** — Muse Spark reads before/after snapshots with the code diff and the stated intent, groups changed snapshots by the code change that caused them, and flags changes nobody asked for, for batch approval or rejection. Needs `cloud-deploy`, and is not ordered against `sync` or `trust`.

**Scope: platforms-upgrade** — Possible future: reach each project's existing D1 through Workers for Platforms bindings instead of the REST API, when the shared API rate limit constrains the service. Requires no data migration.

**Scope: customer-subdomains** — Possible future offer: a subdomain per customer. Independent of `platforms-upgrade`.

**Scope: annotations** — Stretch, if we get to it: agents and humans annotate snapshots and their deltas. Not ordered against the scopes above beyond needing `local-review`.
