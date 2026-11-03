# System

> Status: partly built — rendering environments are built in `docs/specs/render.md`, local approvals in `docs/specs/snapshots.md`, the local CLI in `docs/specs/cli.md`, and the local review UI in `docs/specs/ui.md`; everything under `## Future` is design.
>
> - See `docs/specs/glossary.md` for vocabulary.
> - Owns the staged build order and the behavior spanning the local app and the cloud. Image storage belongs to `docs/specs/store.md`.

## Rendering environments

Source of truth: `render/src/environment.ts`, `render/src/capture.ts`. `docs/specs/render.md` owns how the package does this.

- **Must make the rendering environment configurable, and record it with every capture.** An environment is what decides the pixels apart from the project's own input: the container image digest or other runner, its CPU architecture, the browser and its flags, the viewport and scale, and the fixed capture recipe. Project input, such as story code, a settle time, or an init script, is not part of it (`docs/specs/render.md` → Environment).
- **Must default to one pinned Linux arm64 container image**, the only setup measured to match across machines (rationale).
- **Must make the environment part of a snapshot's name**, so images from different environments are never compared, and changing the environment starts new goldens rather than reporting every story as changed. `docs/specs/snapshots.md` → Snapshot names owns how, and a run records its environment.
- **Must let a project freeze its own timers**, since browser options alone don't stop a blinking cursor (rationale).

## Approvals

Source of truth: `store/src/core/snapshots.ts`. `docs/specs/snapshots.md` → Decisions owns how they are recorded.

- **Must not make a user re-approve a snapshot change at a new Git SHA in the same store.** An approval holds for a snapshot's name and image hash, so a run after a commit, rebase, or amend finds it if the pixels are the same.

Reserved: this is the local half of [carrying approvals through a push](#approvals-across-stores).

## Local CLI

Source of truth: `cli/src/`. `docs/specs/cli.md` owns how it works.

- **Must let an agent use the loop without a UI:** `selfie review` records snapshots locally and outputs JSON with image paths, and `selfie approve`, `reject`, and `accept` act on the run it names. Its exit codes tell an agent whether anything blocks. The same logic is a library, for the review UI.
- **Must keep local data under `~/.config/selfie/<git-origin-slugified>/`.**

## Local review

Source of truth: `ui/src/`, `cli/src/ui.ts`. `docs/specs/ui.md` owns how it works, and `docs/specs/access.md` → Local review server who may reach it.

- **Must let a person review a run in a browser, on their own machine:** `selfie ui` serves a Hono app using GitHub Primer, with approve, reject, and accept.
- **Must keep what's specific to a platform behind one seam**, so [`cloud-deploy`](#build-order) can serve the same routes and screens from a Worker.
- **Never render from the UI.** A person runs `selfie review` and looks at what it recorded.

## Future

### Environment selection

An agent skill could help a project test its own setup and find an environment that works for it.

### Opaque images only

Selfie is for fully opaque images, and transparency is never allowed: `docs/specs/store.md` → Image identity owns the rule, and `docs/specs/store.md` → Image decoding what happens to an image with alpha.

### Approvals across stores

- **Must not make a user re-approve at push a snapshot change they already approved locally.** A user can approve changes on an unpushed PR, and those approvals carry through the push. The record is built ([Approvals](#approvals)) and keyed so it can move between stores. Moving it is `sync`'s job, as `docs/specs/snapshots.md` → Future says.

### Cloud data

| Data | Lives in |
|---|---|
| User accounts and their GitHub tokens, app installations, and which D1 database belongs to each project | Neon Postgres |
| A project's snapshot metadata | That project's own D1 database |
| Image bytes | R2 |

- **Never put snapshot metadata in Neon or account data in a project's D1.**

### Build order

**Scope: store** — `docs/specs/store.md`.

**Scope: cloud-deploy** — The same Hono app ([Local review](#local-review)) deployed at `hackathon.selfie.dev`, with accounts in Neon through pgstencil and Hyperdrive, per-project D1, and R2 ([Cloud data](#cloud-data)). Serves no image before `github-access`.

**Scope: github-access** — The GitHub App, sign-in, and access checks (`docs/specs/access.md`). Ships with `cloud-deploy`, since a deployed service needs them before it holds anyone's images.

**Scope: sync** — Push and pull between stores, and the cloud half of `find-baseline`, whose local half is built (`docs/specs/cli.md` → find-baseline). Local approvals carry through here ([Approvals across stores](#approvals-across-stores)).

**Scope: trust** — The cloud accepts local results without re-rendering.

**Scope: change-grouping** — Muse Spark reads before/after snapshots with the code diff and the stated intent, groups changed snapshots by the code change that caused them, and flags changes nobody asked for, for batch approval or rejection. Needs `cloud-deploy`, and is not ordered against `sync` or `trust`.

**Scope: platforms-upgrade** — Possible future: reach each project's existing D1 through Workers for Platforms bindings instead of the REST API, when the shared API rate limit constrains the service. Requires no data migration.

**Scope: customer-subdomains** — Possible future offer: a subdomain per customer. Independent of `platforms-upgrade`.

**Scope: remote-notes** is defined in `docs/specs/feedback.md` → Future.
