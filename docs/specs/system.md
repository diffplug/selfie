# System

> Status: partly built — rendering environments are built in `docs/specs/render.md`, local approvals in `docs/specs/renders.md`, the local CLI in `docs/specs/cli.md`, the local review UI in `docs/specs/ui.md`, and a Worker for one writer's public projects in `docs/specs/cloud.md`; everything under `## Future` is design.
>
> - See `docs/specs/glossary.md` for vocabulary.
> - Owns the staged build order and the behavior spanning the local app and the cloud. Image storage belongs to `docs/specs/store.md`.

## Rendering environments

Source of truth: `render/src/environment.ts`, `render/src/render.ts`. `docs/specs/render.md` owns how the package does this.

- **Must make the rendering environment configurable, and record it with every render.** An environment is what decides the pixels apart from the project's own input: the container image digest or other runner, its CPU architecture, the browser and its flags, the viewport and scale, and the fixed render recipe. Project input, such as story code, a viewport a story declares, a settle time, or an init script, is not part of it (`docs/specs/render.md` → Environment).
- **Must default to one pinned Linux arm64 container image**, the only setup measured to match across machines (rationale).
- **Must make the environment part of a render's name**, so images from different environments are never compared, and changing the environment starts over rather than reporting every story as changed. `docs/specs/renders.md` → Render names owns how, and a batch records its environment.
- **Must let a project freeze its own timers**, since browser options alone don't stop a blinking cursor (rationale).

## Approvals

Source of truth: `store/src/core/render-batches.ts`. `docs/specs/renders.md` → Decisions owns how they are recorded.

- **Must not make a user re-approve a render change at a new Git SHA in the same store.** `docs/specs/renders.md` → Approvals owns what history reaches.

- **Must not make a user re-approve at push a render change they already approved locally.** A user can approve changes on an unpushed PR, and those approvals carry through the push, since `docs/specs/sync.md` moves decisions with the commit each counts from.

## Local CLI

Source of truth: `cli/src/`. `docs/specs/cli.md` owns how it works.

- **Must let an agent use the loop without a UI:** `selfie review` records renders locally and outputs JSON with image paths, and `selfie approve` and `reject` act on the batch it names. Its exit codes tell an agent whether anything blocks. The same logic is a library, for the review UI.
- **Must keep local data under `~/.config/selfie/<git-origin-slugified>/`.**

## Local review

Source of truth: `ui/src/`, `cli/src/ui.ts`. `docs/specs/ui.md` owns how it works, and `docs/specs/access.md` → Local review server who may reach it.

- **Must let a person review a batch in a browser, on their own machine:** `selfie ui` serves a Hono app using GitHub Primer, with approve and reject.
- **Must keep what's specific to a platform behind one seam**, so [`cloud-deploy`](#build-order) can serve the same routes and screens from a Worker.
- **Never render from the UI.** A person runs `selfie review` and looks at what it recorded.

## Future

### Environment selection

An agent skill could help a project test its own setup and find an environment that works for it.

### Opaque images only

Selfie is for fully opaque images, and transparency is never allowed: `docs/specs/store.md` → Image identity owns the rule, and `docs/specs/store.md` → Image decoding what happens to an image with alpha.

### Cloud data

| Data | Lives in |
|---|---|
| User accounts and their GitHub tokens, app installations, and which D1 database belongs to each project | Neon Postgres |
| A project's render metadata | That project's own D1 database |
| Image bytes, and built Storybooks' files | R2 |

- **Never put render metadata in Neon or account data in a project's D1.**

### Build order

**Scope: store** — `docs/specs/store.md`.

**Scope: cloud-deploy** — The same Hono app ([Local review](#local-review)) deployed at `hackathon.selfie.dev`, with per-project D1 and R2, is built for a few public repositories and one writer (`docs/specs/cloud.md`). What's left is accounts in Neon through pgstencil and Hyperdrive ([Cloud data](#cloud-data)), and private repositories, which wait for `github-access`.

**Scope: github-access** — Sign-in through GitHub, and access checks from what GitHub reports (`docs/specs/access.md` → Future), before the service holds anyone else's images.

**Scope: trust** — The cloud accepts local results without re-rendering.

**Scope: change-grouping** — Muse Spark reads before/after renders with the code diff and the stated intent, groups changed renders by the code change that caused them, and flags changes nobody asked for, for batch approval or rejection. Asking it about one story's change is built (`docs/specs/chat.md`). Is not ordered against `sync` or `trust`.

**Scope: platforms-upgrade** — Possible future: reach each project's existing D1 through Workers for Platforms bindings instead of the REST API, when the shared API rate limit constrains the service. Requires no data migration.

**Scope: customer-subdomains** — Possible future offer: a subdomain per customer. Independent of `platforms-upgrade`.

**Scope: remote-notes** is defined in `docs/specs/feedback.md` → Future.
