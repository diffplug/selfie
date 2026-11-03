# Selfie - distributed Storybook testing (and agent control surface)

Visual screenshot testing is an excellent control surface for directing coding agents. Using snapshots inside the coding loop can increase snapshot counts by 100x to 1000x, which is wildly unaffordable with existing centralized snapshot services such as Chromatic.

Selfie rethinks this model:

- coding models can (and should!) generate snapshots locally to validate and document their work
- this local work can (optionally) be trusted to dramatically reduce cloud snapshot usage (\~100x faster and cheaper)
- agents and humans should be able to directly annotate the snapshots and their deltas, during local development and cloud review

Selfie is piloting with StorybookJS, but PRs to support other testing models are welcome.

A hosted instance runs at [hackathon.selfie.dev](https://hackathon.selfie.dev).

## Quickstart

You'll need Node 26 or later, pnpm, and Docker running, since stories render in a pinned browser in a container. Your project needs a Storybook (7 or later) in a Git repository.

**1. Install Selfie.** It isn't on npm yet, so run it from a checkout:

```sh
git clone https://github.com/diffplug/selfie-hackathon
cd selfie-hackathon
pnpm install
alias selfie="node --disable-warning=ExperimentalWarning $PWD/cli/src/main.ts"
```

The alias lasts for this terminal, so add it to your shell's profile, with the full path, to keep it.

**2. Tell it how to build your Storybook.** Add `selfie.config.json` at the top of your repository, and make sure Git ignores the output directory:

```json
{
  "storybookDir": "storybook-static",
  "buildCommand": "npx storybook build"
}
```

**3. Open it.** From your repository:

```sh
selfie
```

This builds your Storybook, serves it, and opens your browser. The left side lists every story, as Storybook's sidebar does. The right side is a checklist of where your commit stands, and says what to do if something's missing.

**4. Render a story.** Pick a story to see it running, then press `c`, or click **Render it**. The first render downloads the browser, which can take a few minutes. Rendering keeps an image of that story with your commit. Press `m` to write a note on it for a coding agent. **Render all** on the checklist does every story.

**5. Make your first goldens.** Goldens are the images later changes get compared with. On your default branch, with nothing uncommitted:

1. Click **Render all**, then **Review the newest run**.
2. Click **Approve all** and confirm, then **Accept this run** and confirm.

**6. See a diff.** On a new branch, change a component and commit it. Stop `selfie` and start it again, so it rebuilds, then click **Render all** and **Review the newest run**. The tree now lists only what changed, was added, or was removed, and each story's page shows the images side by side. `j` and `k` go through them, and `a` and `r` approve and reject.

**7. Check that it's stable.** If a story changes when you didn't touch it, find out why:

```sh
selfie flakes
```

It renders everything several times and lists what wasn't the same. `selfie skill fix-flakes` prints a guide for a coding agent to fix what it finds. A project can also change how stories render, such as using dark mode, with `environment.recipe` in `selfie.config.json` (`docs/specs/render.md`).

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
- review - shows a run's diff against its baseline, or until one exists, against the nearest goldens on its branch, as one JSON document whose exit code says whether anything blocks. With no run, it uses the one for this exact built Storybook, which takes about 0.3 s rather than 70 s on 541 stories, and records one only if there's none yet. `--baseline` compares with a commit's goldens or another run, so recording twice and comparing is how to look for flakiness
- approve, reject - decides on a run's changed snapshots, on a dirty tree if you like, so committing doesn't ask again
- accept - makes a run's snapshots the goldens for its Git sha, on a clean tree
- push, pull - move a run, its decisions, and its goldens to and from the cloud, whose goldens win
- flakes - renders a built Storybook several times, and says what wasn't the same each time. `selfie skill fix-flakes` is a guide for a coding agent to fix what it finds
- ui - serves a local review page in the browser, to look at a run's images, approve, reject, and accept. It renders only when you ask it to on the page.
- selfie, with no command - opens every story of a built Storybook, running, to write notes on, which renders what they're on
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
