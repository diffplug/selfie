# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two primary audiences, weighted equally:

- **Developers steering coding agents on a StorybookJS project**, who want visual review inside the agent's loop.
- **Frontend teams paying for a hosted visual testing service such as Chromatic**, who are looking for a cheaper or local replacement.

Secondary audience: existing users of the Selfie snapshot testing library (Java, Kotlin, Python). They need one thing from selfie.dev, which is to get to lib.selfie.dev.

## Product Purpose

Selfie is distributed Storybook testing: a visual review gate that runs on your machine beside your agent, in CI, and on GitHub. It exists because putting renders inside the coding loop can multiply render counts by 100x to 1000x, which is wildly unaffordable with centralized render services.

selfie.dev is the product's home. It introduces Selfie, sends people to the repository and quickstart, and honors the permanent redirects for the older library.

**Near-term milestone:** the local-only install and a selfie.dev mailing list signup launch together.

## Positioning

Renders happen where the agent runs, with no cloud required and no bill per image, and `selfie review` gives the agent one JSON document and an exit code. That is what makes visual review affordable at agent scale.

## Operating Context

- An agent runs `selfie review`, looks at the diff images it names, runs `selfie approve <batch> --all`, commits, and reviews again.
- A person uses `selfie ui` for the same loop, and can leave notes on an image for the agent to act on and answer.
- In CI, a GitHub Action renders each push, and the commit gets a `selfie` status linking to its review.
- Setup starts from a checkout, by pasting the quickstart prompt into a coding agent. It needs Node 26 or later, pnpm, and Docker.

## Capabilities and Constraints

**Built:** the local loop, CI, and commit statuses, in use on Selfie's own repository. Change classification (moved or gained spacing versus really changed), notes on images, Git-following approvals, reproducible renders in a digest-pinned container, and `selfie flakes`.

**Not built:** an npm package, signing in through GitHub, private repositories, notes in the cloud, and trusting local results without re-rendering. Don't imply any of these exist.

**The app:** the review UI uses GitHub Primer and looks exactly like GitHub, with no distinctive style of its own.

**Hosting:** Cloudflare Pages project `selfie-landing`, serving static files from `public/`. `lib.selfie.dev` stays on a separate project.

**Reserved paths:** `/jvm`, `/py`, `/demo-gif`, `/go`, `/other-platforms`, and `/js` are permanent redirects, because released jars and wheels link to them. They can't be reused for anything on this site.

**Terminology:** the library and this product share a name and a general theme but no code. Keep them clearly separate.

**Mailing list:** MailerLite form "selfie.dev signup", which adds people to the group "selfie.dev launch" with double opt-in. Mail comes from Selfie <hello@selfie.dev>, a Google Workspace group, and selfie.dev is authenticated for sending (DKIM, SPF). The signup replaced the nedshed.dev link, and the list launches at the same time as the local-only install.

## Brand Commitments

- The name is Selfie, from DiffPlug LLC.
- The "robots taking selfies" theme stays, and the premise can be playful. The art itself should be serious: the owner rejected the cute anime style. The current hero robot isn't binding, and the logo and mascot reused from the earlier library (Apache-2.0, `LICENSE-branding`) are available rather than required.
- Background: [Surrendering to grooves in latent space](https://nedshed.dev/p/surrendering-to-grooves-in-latent-space) tells how the name and theme came about. Phones beat DSLRs because they have fewer, simpler controls, and that idea shaped the earlier library's design.
- Jost is the typeface. Bagel Fat One and Andika were tried and rejected.
- Muse Spark stays off selfie.dev. The owner treats it as hackathon-only, not lasting product truth.
- The library notice stays verbatim, as specified in selfie-hackathon#26.

The rest of the branding is unsettled. The owner intends to work it out next, and the mailing list's branding will follow it.

## Evidence on Hand

- **Render timing on an M4 MacBook Air, per the selfie-hackathon README:** about 140 stories in under 30 seconds, and 541 stories in about 70 seconds. Reviewing an already-rendered build takes under half a second.
- **Scale example:** one style tweak changed 290 of a Storybook's 541 stories.
- **Videos:** [Why Selfie](https://youtu.be/8B3-v4DTwfU), and an [older product demo](https://youtu.be/FiGuwfB13b0) of a two-line CSS change touching all 124 stories. The README's [current demo](https://youtu.be/ZrUv0Pn7yyc) is built around Muse Spark.
- **Live proof:** [Selfie reviewing itself](https://hackathon.selfie.dev/diffplug/selfie-hackathon), viewable without signing in.
- **Assets:** `public/img/mascot.webp`, `public/logo-icon.svg`, `public/img/video-why.webp`, `public/img/video-demo.webp`, `public/img/og.png`.
- **Absent:** customers, testimonials, press, pricing, and a mailing list. Don't fabricate them.

## Product Principles

1. Be exact about what's built. It's a pilot, and saying so plainly is part of being believable.
2. Serve both primary audiences without making either feel like an afterthought.
3. Never strand a library user. Released artifacts link here, and those links must keep working.
4. Lead with what a local, agent-sized workflow makes possible, backed by real measurements.
