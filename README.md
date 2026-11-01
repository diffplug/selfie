# Selfie - distributed Storybook testing (and agent control surface)

Visual screenshot testing is an excellent control surface for directing coding agents. Using snapshots inside the coding loop can easily increase snapshot counts by 100x to 1000x, which is wildly unaffordable with existing centralized snapshot services such as Chromatic.

Selfie rethinks this model:

- coding models can (and should!) generate snapshots locally to validate and document their work
- this local work can (optionally) be trusted to dramatically reduce cloud snapshot usage (\~100x faster and cheaper)
- agents and humans should be able to directly annotate the snapshots and their deltas, during local development and cloud review

Selfie is piloting with StorybookJS, but PRs to support other testing models are welcome.

## System architecture

Selfie stores data in two places:

- a cloud service holding golden snapshot data, as well as runs which are pending approval before being accepted as golden
- local data stored at `~/.config/selfie/<git-origin-slugified>/`, Selfie stores locally generated snapshots here, and also mirrors data from the cloud service as necessary to improve performance

Selfie has the following commands:

- find-baseline - returns the Git sha of the nearest merge-base with a complete set of goldens
- review - records snapshots (only if necessary) and shows the diff against

## Implementation details

- image snapshots are always referred to by the SHA256 hash of the snapshot pixel data in the PMAP format
  - the db primary key of images is based on this SHA256, truncated to the safe range for positive javascript integers
  - a table of hash collisions is maintained, they are inserted into the table as monotonic negative integers
- local app is built with SQLite, Typescript and Vite
- cloud server is implemented with SQLite (typically Cloudflare D1) and Hono (typically Cloudflare Workers), Typescript and Vite

## License

[FSL-1.1-MIT](LICENSE) — Copyright 2026 DiffPlug LLC
