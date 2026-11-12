# Selfie - distributed Storybook testing

Visual screenshot testing is an excellent control surface for directing coding agents. Using renders inside the coding loop can increase render counts by 100x to 1000x, which is wildly unaffordable with existing centralized render services such as Chromatic.

Selfie is a visual review gate built for that loop. It runs on your machine beside your agent, in CI, and on GitHub, and when you want to know why something changed, you can ask Muse Spark. It's piloting with StorybookJS, and PRs to support other testing models are welcome.

Go to [selfie.dev](https://selfie.dev) to follow development after the hackathon.

## Watch it

| [Why Selfie](https://youtu.be/8B3-v4DTwfU) | [Product demo](https://youtu.be/ZrUv0Pn7yyc) |
| --- | --- |
| <a href="https://youtu.be/8B3-v4DTwfU"><img src="https://img.youtube.com/vi/8B3-v4DTwfU/maxresdefault.jpg" alt="Watch: Why Selfie" width="380" /></a> | <a href="https://youtu.be/ZrUv0Pn7yyc"><img src="https://img.youtube.com/vi/ZrUv0Pn7yyc/maxresdefault.jpg" alt="Watch: Selfie product demo" width="380" /></a> |
| From Storybook to Chromatic to Selfie: why snapshot testing has to change for coding agents. | The real app: two lines of CSS touch all 142 stories, and Muse Spark finds what broke dark mode. |

You can also look around the hosted review pages without signing in: here's [Selfie reviewing itself](https://app.selfie.dev/diffplug/selfie).

## What it does

- **Fits an agent's loop.** `selfie review` prints one JSON document naming the diff images, with an exit code that says whether anything blocks.
- **Runs where the agent runs.** On an M4 MacBook Air, Selfie's own Storybook of about 140 stories renders in under 30 seconds, with no cloud and no bill per image. A larger Storybook of 541 stories takes about 70 seconds. Reviewing a build that's already rendered takes under half a second.
- **Says what kind of change it is.** Selfie separates what moved or gained spacing from what really changed, and finds one change repeated across stories, so you can accept it once.
- **Tells you why, with Muse Spark.** On a changed story in the cloud, ask what caused it. Muse Spark reads the before, after, and diff images and the code from GitHub, and it can point out what nobody asked for.
- **Lets you point at the problem.** Write a note on an image, and your agent gets your words, the exact box, and a picture of what you saw. It answers on the same note, and you flip between before and after.
- **Follows Git.** An approval counts wherever history reaches it, so it isn't repeated after a commit, a rebase, or a merge.
- **Keeps the pixels reproducible.** Stories render in a container pinned by digest, and `selfie flakes` finds any that still vary between renders.
- **Reports on every commit.** A GitHub Action renders each push, and the commit gets a `selfie` status that links to its review.

## Quickstart

Paste this into your coding agent, in your project:

```text
Set up Selfie in this repository. If you don't have a checkout of it, clone
https://github.com/diffplug/selfie outside this repository, and run
pnpm install there. Then run this, and follow what it prints:

node --disable-warning=ExperimentalWarning <checkout>/cli/src/main.ts skill quickstart
```

It works out how your Storybook builds, writes `selfie.config.json`, proves that a story really renders, warns you about anything in your way, such as uncommitted changes, and offers to set up commit statuses on GitHub. It won't commit anything without asking. You'll get a URL to open, and what to do next.

You'll need Node 26 or later, pnpm, and Docker. Selfie isn't on npm yet, which is why this starts from a checkout.

## How it works

**An agent's loop:** `selfie review`, then look at the diff images it names, then `selfie approve <batch> --all`, commit, and `selfie review` again, which has nothing left to ask.

**A person's loop** is the same, with `selfie ui` for the looking and deciding.

**To work together,** a person leaves notes on any story in `selfie ui`, and either copies them into any agent, or presses Send while the agent runs `selfie agent-await-feedback`. The agent acts on them, runs `selfie render`, and answers each with `selfie reply`. The person flips against the image they commented on, and resolves the note or answers back.

**In the cloud,** a GitHub Action renders every pushed branch and uploads its batch. Each commit gets a `selfie` status: red if a story failed or a person rejected a change, yellow if a change is undecided, and green if everything matches what's approved. On a changed story's page, anyone can ask Muse Spark about the change.

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
| `skill` | Prints a guide for a coding agent: `quickstart` to set Selfie up in a repository, and `fix-flakes` to make every story render the same way |

## What's built, and what isn't

The local loop, CI, and commit statuses are all built and in use on this repository.

The cloud service at [app.selfie.dev](https://app.selfie.dev) is deployed for a few public repositories. Anyone can view them, and ask Muse Spark about a story's change. For now only one person can sign in, through GitHub, to approve or upload.

Not built yet:

- **Change grouping with Muse Spark** ([below](#meta-models))
- **Trusting local results,** so that the cloud can accept an agent's renders without rendering them again
- **Signing in for everyone,** with access that follows GitHub's permissions, and private repositories
- **Notes in the cloud.** Notes are local for now
- **An npm package**

## Built for the Meta Global AI Developer Hackathon

We previously launched [Selfie](https://lib.selfie.dev), a snapshot testing library focused on data rather than screenshots with no cloud or agent integrations. We are backgrounding it to focus on this completely new and unrelated service, which shares the same general theme and name but none of its code. Everything in this repo was built from November 1, 2026 onward for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details). The one exception is `branding/`: the logo and mascot are reused from the earlier library.

### Meta models

Most of the event went on the foundation: rendering, storage, review, and sync. **Selfie calls a Meta model in one place so far: asking Muse Spark about a change.**

Selfie's own code can say exactly which pixels differ and whether content moved, but not why, or whether anyone wanted it. So on a changed story's page in the cloud service, anyone can ask. For each question, `muse-spark-1.3` reads:

- the image last approved, the new image, and their diff
- the measurements of their differences
- the commits and code diff from GitHub, from what was approved to this commit

In the [product demo](https://youtu.be/ZrUv0Pn7yyc), we asked it the page's own starter question, "What code caused this change?", about a commit whose request was only for more room in a top bar. Muse Spark found the CSS, and then raised the bug by itself:

> What was not asked for in that message is the color: in this `--dark` story the old bar is dark and the new bar is white/light. The `background: #f6f8fa` line is fixed light instead of the theme variable, so check dark mode before accepting.

We wrote that bug on purpose for the demo, and that answer is real and unedited.

It's built to be safe to leave open on a public page. Each answer says which code it read and what it left out. The model has no tools, and its answer is plain text, so an instruction hidden in a branch's code has nothing to act with. An answer can never approve, reject, or block anything. See [`docs/specs/chat.md`](docs/specs/chat.md).

That matters at agent scale: one style tweak we measured changed 290 of a Storybook's 541 stories. The next step, specified in [`docs/specs/system.md`](docs/specs/system.md) as `change-grouping`, is to ask about a whole batch, grouping changed stories by the code change that caused them, and flagging the changes nobody asked for.

To run your own, set `MODEL_API_KEY` to a Meta Model API key. The hosted demo needs no key.

## Architecture

Selfie stores data in two places:

- **Locally,** at `~/.config/selfie/<git-origin-slugified>/`, in SQLite and image files. Locally generated renders live here, along with what's mirrored from the cloud.
- **In the cloud,** in a Hono app on Cloudflare Workers at `app.selfie.dev`, with render metadata in a per-project D1 database and image bytes in R2. Signing in goes through GitHub, with [pgstencil](https://github.com/diffplug/pgstencil) keeping its sessions in Postgres. Built Storybooks are served from `selfieusercontent.com`, a site of their own.

The landing page at `selfie.dev` is plain HTML in [`site/`](site/), on Cloudflare Pages. [OPERATIONS.md](OPERATIONS.md) says how each is deployed.

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
