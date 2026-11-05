<img height="80" width="80" src="branding/logo-icon.svg" />

# Selfie - distributed Storybook testing (and agent control surface)

Visual screenshot testing is an excellent control surface for directing coding agents. Using renders inside the coding loop can increase render counts by 100x to 1000x, which is wildly unaffordable with existing centralized render services such as Chromatic.

Selfie is a visual review gate built for that loop. It runs on your machine beside your agent, in CI, and on GitHub, and it's piloting with StorybookJS. PRs to support other testing models are welcome.

## Watch it

| [Why Selfie](https://youtu.be/8B3-v4DTwfU) | [Product demo](https://youtu.be/FiGuwfB13b0) |
| --- | --- |
| [![Watch: Why Selfie](https://img.youtube.com/vi/8B3-v4DTwfU/maxresdefault.jpg)](https://youtu.be/8B3-v4DTwfU) | [![Watch: Selfie product demo](https://img.youtube.com/vi/FiGuwfB13b0/maxresdefault.jpg)](https://youtu.be/FiGuwfB13b0) |
| From Storybook to Chromatic to Selfie: why snapshot testing needs to change for coding agents. | The real app: a two-line CSS change touches all 124 stories, and a person and an agent work through it together. |

You can also look around the hosted review pages without signing in: here's [Selfie reviewing itself](https://hackathon.selfie.dev/diffplug/selfie-hackathon).

## What it does

- **Fits an agent's loop.** `selfie review` prints one JSON document naming the diff images, with an exit code that says whether anything blocks.
- **Runs where the agent runs.** On an M4 MacBook Air, Selfie's own 124 stories render in about 25 seconds, with no cloud and no bill per image. A larger Storybook of 541 stories takes about 70 seconds. Reviewing a build that's already rendered takes under half a second.
- **Says what kind of change it is.** Selfie separates what moved or gained spacing from what really changed, so you can approve the harmless ones together.
- **Lets you point at the problem.** Write a note on an image, and your agent gets your words, the exact box, and a picture of what you saw. It answers on the same note, and you flip between before and after.
- **Follows Git.** An approval counts wherever history reaches it, so it isn't repeated after a commit, a rebase, or a merge.
- **Gives the same pixels everywhere.** Stories render in a pinned container, and `selfie flakes` finds any that still vary between renders.
- **Reports on every commit.** A GitHub Action renders each push, and the commit gets a `selfie` status that links to its review.

## Quickstart

Paste this into your coding agent, in your project:

```text
Set up Selfie in this repository. If you don't have a checkout of it, clone
https://github.com/diffplug/selfie-hackathon outside this repository, and run
pnpm install there. Then run this, and follow what it prints:

node --disable-warning=ExperimentalWarning <checkout>/cli/src/main.ts skill quickstart
```

It works out how your Storybook builds, writes `selfie.config.json`, proves that a story really renders, warns you about anything in your way, such as uncommitted changes, and offers to set up commit statuses on GitHub. It won't commit anything without asking. You'll get a URL to open, and what to do next.

You'll need Node 26 or later, pnpm, and Docker. Selfie isn't on npm yet, which is why this starts from a checkout.

## How it works

**An agent's loop:** `selfie review`, then look at the diff images it names, then `selfie approve <batch> --all`, commit, and `selfie review` again, which has nothing left to ask.

**A person's loop** is the same, with `selfie ui` for the looking and deciding.

**To work together,** a person leaves notes on any story in `selfie ui`, and either copies them into any agent, or presses Send while the agent runs `selfie agent-await-feedback`. The agent acts on them, runs `selfie render`, and answers each with `selfie reply`. The person flips against the image they commented on, and resolves the note or answers back.

**In the cloud,** a GitHub Action renders every pushed branch and uploads its batch. Each commit gets a `selfie` status: red if a story failed or a person rejected a change, yellow if a change is undecided, and green if everything matches what's approved.

A project needs a `selfie.config.json` at its Git top level, which says where its built Storybook is and how to build it, and may also set its environment, init script, and how close changed hunks join.

### Commands

From a checkout, `pnpm selfie <command>` runs these.

| Command | Does |
| - | - |
| `render` | Always renders the Storybook, and records a batch |
| `review` | Shows a batch's diff against what its history has approved, as one JSON document whose exit code says whether anything blocks. With no batch, it uses the one for this exact built Storybook, and records one only if there's none yet. `--baseline` compares with what a commit's history approved, or with another batch |
| `approve`, `reject` | Decides on what a batch changed, added, or removed, on any branch, on a dirty tree if you like |
| `ui` | Serves a local review page, to look at a batch's images, approve, and reject. It renders only when you ask it to on the page |
| `selfie`, with no command | Opens every story of a built Storybook, running, to write notes on, which renders what they're on |
| `notes`, `agent-await-feedback`, `reply` | How a person's notes on the images reach a coding agent, and how it answers |
| `push`, `pull` | Sends a batch and its decisions to the cloud, and takes what a commit's history approved from it |
| `flakes` | Renders a built Storybook several times, and says what wasn't the same each time. `selfie skill fix-flakes` is a guide for a coding agent to fix what it finds |

## What's built, and what isn't

The local loop, CI, and commit statuses are all built and in use on this repository.

The cloud service at [hackathon.selfie.dev](https://hackathon.selfie.dev) is deployed for a few public repositories. Anyone can view them, and for now only one person can sign in to approve or upload.

Not built yet:

- **Change grouping with Muse Spark** ([below](#meta-models))
- **Trusting local results,** so that the cloud can accept an agent's renders without rendering them again
- **Signing in through GitHub,** with access that follows GitHub's permissions, and private repositories
- **Notes in the cloud.** Notes are local for now
- **An npm package**

## Built for the Meta Global AI Developer Hackathon

We previously launched [Selfie](https://lib.selfie.dev), a snapshot testing library focused on data rather than screenshots with no cloud or agent integrations. We are backgrounding it to focus on this completely new and unrelated service, which shares the same general theme and name but none of its code. Everything in this repo was built from November 1, 2026 onward for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details).

### Meta models

**As submitted, Selfie doesn't call a Meta model.** We spent the event building the foundation: rendering, storage, review, and sync.

The planned integration is specified in [`docs/specs/system.md`](docs/specs/system.md) as `change-grouping`. It would send Muse Spark the before and after renders, the code diff, and the stated intent of the change, then group the changed renders by the code change that caused them, and flag the changes nobody asked for. Selfie's own code can say exactly which pixels differ and whether content moved, but not why, or whether anyone wanted it. That matters at agent scale: one style tweak we measured changed 290 of a Storybook's 541 stories.

## Architecture

Selfie stores data in two places:

- **Locally,** at `~/.config/selfie/<git-origin-slugified>/`, in SQLite and image files. Locally generated renders live here, along with what's mirrored from the cloud.
- **In the cloud,** in a Hono app on Cloudflare Workers, with render metadata in a per-project D1 database and image bytes in R2.

Implementation details:

- image renders are fully opaque 8-bit RGB, and transparency is not supported
- image renders are always referred to by the SHA256 hash of the render pixel data in the PAM format
  - the db primary key of images is based on this SHA256, truncated to the safe range for positive javascript integers
  - images whose truncated hash collides are stored in the same table under monotonic negative integers
- stories render with Playwright, in a container pinned by digest
- the local app is built with SQLite, TypeScript and Vite
- the review UI is a Hono app with GitHub Primer, on loopback only when it's local
- commit statuses come from a GitHub App

The full reference is in [`docs/specs/`](docs/specs/). Start with the [glossary](docs/specs/glossary.md).

## Third-party open source

- [Storybook](https://storybook.js.org) (MIT)
- [Playwright](https://playwright.dev) (Apache-2.0)
- [Hono](https://hono.dev) (MIT)
- [Vite](https://vite.dev) (MIT)
- [GitHub Primer](https://primer.style) (MIT)
- [React](https://react.dev) (MIT)
- [sharp](https://sharp.pixelplumbing.com) (Apache-2.0)
- [SQLite](https://sqlite.org) (public domain)

The two videos are built in [`demo-video/`](demo-video/) and [`product-demo/`](product-demo/) with [HyperFrames](https://hyperframes.heygen.com) (Apache-2.0), [GSAP](https://gsap.com) ([standard license](https://gsap.com/standard-license)), and the Bagel Fat One and Jost fonts (OFL-1.1), with voiceover from [ElevenLabs](https://elevenlabs.io).

## License

[FSL-1.1-MIT](LICENSE) — Copyright 2026 DiffPlug LLC
