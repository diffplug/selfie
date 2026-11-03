# Selfie - distributed Storybook testing (and agent control surface)

Visual screenshot testing is an excellent control surface for directing coding agents. Using snapshots inside the coding loop can increase snapshot counts by 100x to 1000x, which is wildly unaffordable with existing centralized snapshot services such as Chromatic.

Selfie rethinks this model:

- coding models can (and should!) generate snapshots locally to validate and document their work
- this local work can (optionally) be trusted to dramatically reduce cloud snapshot usage (\~100x faster and cheaper)
- agents and humans should be able to directly annotate the snapshots and their deltas, during local development and cloud review

Selfie is piloting with StorybookJS, but PRs to support other testing models are welcome.

A hosted instance runs at [hackathon.selfie.dev](https://hackathon.selfie.dev).

## Built for the Meta Global AI Developer Hackathon

We previously launched [Selfie](https://lib.selfie.dev), a snapshot testing library focused on data rather than screenshots with no cloud or agent integrations. We are backgrounding it to focus on this completely new and unrelated service, which shares the same general theme and name but none of its code. Everything in this repo was built from November 1, 2026 onward for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details).

Pre-existing work used here:

- [pgstencil](https://github.com/diffplug/pgstencil) (MIT, DiffPlug LLC), consumed as published npm packages to bootstrap the Postgres backend. None of its source is copied into this repo.

## Where Meta models are used

Every model Selfie calls at runtime is a Meta model.

- **Muse Spark** (Meta Model API), in the cloud service: reads the before/after snapshots together with the code diff and the stated intent of the change (commit message, PR description, or agent prompt), groups the changed snapshots by the code change that caused them, and flags changes that weren't asked for so they can be approved or rejected in batches.
- **Muse Code**, in the local loop: the coding agent that makes a change, runs `review`, and fixes the regressions Selfie flags. Selfie itself works with any coding agent.

These parts are ordinary code, not model calls: rendering snapshots (Storybook), hashing and pixel-diffing images, finding baselines with git, and storing data (SQLite locally; in the cloud, Neon Postgres for accounts, a D1 database per project for snapshot metadata, and R2 for image bytes).

## System architecture

Selfie stores data in two places:

- a cloud service holding golden snapshot data, as well as runs which are pending approval before being accepted as golden
- local data stored at `~/.config/selfie/<git-origin-slugified>/`, Selfie stores locally generated snapshots here, and also mirrors data from the cloud service as necessary to improve performance

Access follows GitHub through a GitHub App: anyone can view a public repository's snapshots, and a private repository's are visible only to people with access to it on GitHub.

Selfie has the following commands:

- find-baseline - returns the Git sha of the nearest merge-base with a complete set of goldens
- record - always renders the Storybook, and records a run
- review - shows a run's diff against its baseline, or until one exists, against the nearest goldens on its branch, as one JSON document whose exit code says whether anything blocks. With no run, it uses the one for this exact Storybook build, which takes about 0.3 s rather than 70 s on 541 stories, and records one only if there's none yet. `--baseline` compares with a commit's goldens or another run, so recording twice and comparing is how to look for flakiness
- approve, reject - decides on a run's changed snapshots, on a dirty tree if you like, so committing doesn't ask again
- accept - makes a run's snapshots the goldens for its Git sha, on a clean tree
- push, pull - move a run, its decisions, and its goldens to and from the cloud, whose goldens win
- ui - serves a local review page in the browser, to look at a run's images, approve, reject, and accept. It renders only when you ask it to capture a story on the page.
- notes, agent-await-feedback, reply - how a person's notes on the images reach a coding agent, and how it answers

An agent's loop is `selfie review`, then look at the diff images it names, then `selfie approve <run> --all`, commit, `selfie review`, and `selfie accept <run>`. A project sets its environment, init script, Storybook directory, and how close changed regions join in `selfie.config.json` at its Git top level. A person's loop is the same with `selfie ui` for the looking and deciding. To work together, a person leaves notes on any story in `selfie ui`, and either copies them into any agent, or presses Send while the agent runs `selfie agent-await-feedback`. The agent acts on them, runs `selfie record`, and answers each with `selfie reply`, and the person flips against the image they commented on, and resolves it or answers back. See `docs/specs/feedback.md`. These work on local data, and push and pull are built, but no server is deployed for them yet. See `docs/specs/cli.md` and `docs/specs/ui.md`.

## Implementation details

- image snapshots are fully opaque 8-bit RGB, and transparency is not supported
- image snapshots are always referred to by the SHA256 hash of the snapshot pixel data in the PAM format
  - the db primary key of images is based on this SHA256, truncated to the safe range for positive javascript integers
  - images whose truncated hash collides are stored in the same table under monotonic negative integers
- local app is built with SQLite, Typescript and Vite
- local review UI is a Hono app with GitHub Primer, on loopback only
- cloud server is implemented with Hono (typically Cloudflare Workers), Typescript and Vite, with user accounts in Neon Postgres (via pgstencil, connecting through Hyperdrive), snapshot metadata in a per-project Cloudflare D1 database, and image bytes in Cloudflare R2

## Third-party open source

- [Storybook](https://storybook.js.org) (MIT)
- [Hono](https://hono.dev) (MIT)
- [Vite](https://vite.dev) (MIT)
- [GitHub Primer](https://primer.style) (MIT)
- [React](https://react.dev) (MIT)
- [SQLite](https://sqlite.org) (public domain)
- [PostgreSQL](https://www.postgresql.org) (PostgreSQL License)
- [pgstencil](https://github.com/diffplug/pgstencil) (MIT)

## License

[FSL-1.1-MIT](LICENSE) — Copyright 2026 DiffPlug LLC
