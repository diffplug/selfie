# Render — Rationale

> Informative companion to [render.md](render.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative. The evidence for the environment itself is in [system.rationale.md](system.rationale.md). All measurements are from 2026-11, on dormouse's Storybook, on a local M4 Mac with Docker Desktop's 10-CPU VM.

## Environment

**`--disable-partial-raster`.** Before this flag, 2 to 7 of the 541 stories differed from an earlier batch with their timers frozen, 12 distinct stories over 10 batches, by a few pixels each. Every difference inspected, on 5 of those stories, sat on an antialiased edge: rounded corners, diagonal strokes in icons, and one 1 px vertical line. Rendering 19 of the affected stories 6 times each, counting stories with more than one distinct PNG:

| Flags added | Stories that varied |
|---|---|
| None | 5 of 19 |
| `--disable-partial-raster` | 0 of 19 |
| `--num-raster-threads=1` | 8 of 19 |
| Both of those | 0 of 19 |
| `--disable-checker-imaging` | 7 of 19 |

With the flag, 7 full batches of all 541 stories, across the settle times, quiet periods, and concurrency below, were byte-identical on 541 of 541. The evidence fits Chromium re-rastering only part of a tile when a repaint lands after the first raster, so timing decides whether an edge is drawn whole or clipped, but Chromium's code wasn't read to confirm it.

**The flag's one-time cost.** It moved 19 of 541 stories compared with the same settings without it, by 350 pixels in total, at most 19 color levels. That happens once, under a new environment ID. The cross-machine table in [system.rationale.md](system.rationale.md) was measured without the flag, and has not been repeated with it.

**Housekeeping flags.** `--use-mock-keychain --password-store=basic` stop macOS keychain prompts. The container's PNGs were byte-identical with them and without them on 30 of 30 sample stories, so they don't belong in the ID.

**Settle time outside the ID.** With a project's timers frozen, settle times from 0 to 500 ms gave identical PNGs on all 541 stories, so tuning it shouldn't restart goldens. A story that does depend on it reports as changed, like any other project input.

**A declared viewport outside the ID.** It's in a story, as its code is, so it reaches the image the same way: that story reads as changed, a person looks, and every other story keeps its goldens. The order of the waits didn't change either, since a loaded story always comes before the render phase, so `waitSequence` stayed where it was.

## Render

**The whole page.** All 541 of dormouse's stories, in the default container, each story rendered twice, on one Mac, 2026-11. Encoding uses `sharp` lossless WebP at effort 4, outside the container.

| | 1× | 1.5× | 2× |
|---|---|---|---|
| Time, both passes | 200 s | 222 s | 287 s |
| Failed, or differing between the two renders | 0 | 0 | 0 |
| Median height | 900 | 1,350 | 1,800 |
| Tallest | 4,949 | 7,424 | 9,898 |
| PNG total | 25.2 MB | 44.6 MB | 62.1 MB |
| WebP total | 8.0 MB | 13.6 MB | 18.7 MB |
| WebP encode, average per image | 29 ms | 56 ms | 94 ms |

Against the viewport render at 1×:

- **341 were identical.**
- **184 were taller, and began with the exact viewport image**, so the viewport had hidden everything below.
- **6 were 5 px wider.** All 6 are app bar or workspace window stories, and the overflow is real: the viewport had cut it off.
- **10 were taller, with a top that differed.** Of the two inspected, one had scrolled to a focused button in the viewport render, and the full page starts at the top. The other drew one `→` differently, in a story that's stable in both modes. Why the mode changes that glyph is unknown. The other 8 were not looked at, though 2 of them share that story's exact count of 2,270 changed pixels.

Across machines at 1×, comparing image hashes: 541/541 between two GitHub arm64 runners (Neoverse-N2), and 541/541 between each of them and a local M4 Mac, with each story rendering the same twice on each machine. At 1.5× and 2×, only the Mac was measured, and that's two renders on one machine.

**How tall a page can be.** A page of a vertical gradient, in the default container at 1×, rendered correctly at its top, middle, and bottom at every height tried, up to 120,000 px. So Chromium isn't the limit here. `decodeImage` is, at 100 million pixels, which refused 90,000 px and accepted 83,000 px at 1200 wide.

**One image check, without `--platform`.** GitHub's arm64 runners have Docker 28.0.4, which rejects `docker image inspect --platform` with `unknown flag: --platform`. On Docker 29.9.2 with the containerd store, that flag also exits 0 for a platform with no content, printing an empty OS and architecture. Plain `inspect` reported the right platform for the default arm64 digest on 28.0.4 and 29.9.2, and for an amd64 digest on an arm64 host on 29.9.2. A multi-platform tag on 29.9.2 answered for the host instead, which is why a multi-platform digest for another platform is refused.

**Container isolation doesn't change pixels.** On the 30-story sample with its freeze, before the raster flag, this package's PNGs were byte-identical on 30 of 30 to an earlier experiment's. The experiment ran as root with `--ipc=host`, a writable root, Docker's default capabilities, no request blocking, a static server, and one story at a time.

**`route.fulfill` instead of a server.** PNGs stayed byte-identical on 30 of 30 sample stories when the static server was replaced. It removes the server, the port, and the MIME table, and a fixed origin keeps a story that reads its location the same in both runners.

**No byte cache.** Caching file bytes in the worker made no measurable difference, and needs a MIME table, since `route.fulfill` only infers a type from a path. All 541 stories at the adopted defaults, alternating:

| | Batch 1 | Batch 2 | Batch 3 |
|---|---|---|---|
| `fulfill({ path })` | 65.0 s | 75.4 s | 73.7 s |
| Byte cache | 68.0 s | 73.1 s | 73.6 s |

**Waits and concurrency.** All 541 stories with the freeze, one pass. With the flag, every batch is byte-identical to the 500 ms settings on 541 of 541. "Quiet" is the network wait: Playwright's `networkidle` is a fixed 500 ms, and the others count in-flight requests.

| Quiet | Settle | Concurrency | Time, flag | Time, no flag | Differences, no flag |
|---|---|---|---|---|---|
| `networkidle` | 500 | 4 | 184.9 s, 184.3 s | 185.2 s | 5 |
| `networkidle` | 100 | 4 | | 129.4 s | 3 |
| `networkidle` | 0 | 4 | | 115.0 s | 7 |
| 500 | 500 | 4 | | 185.3 s | 6 |
| **100** | **100** | 4 | 83.5 s | 85.1 s, 84.6 s | 5, 2 |
| 100 | 0 | 4 | | 78.0 s | 5 |
| 0 | 0 | 4 | | 77.2 s | 6 |
| **100** | **100** | **6** | 66.1 s, then 65.0 to 75.4 s | 67.1 s | 6 |
| **100** | **100** | 8 | 64.3 s | 67.7 s | 5 |
| 100 | 0 | 6 | 71.2 s | | |
| 0 | 0 | 6 | 69.0 s | | |

"Differences, no flag" compares with one earlier full batch, so it counts the partial raster variation, which is why it wanders. The adopted row is 100 ms, 100 ms, and 6 stories at a time, about 64% less time than where it started. Below that the time stops improving, since the CPUs become the limit, so 0 ms would give up the margin for nothing. Concurrency 8 is within the noise of 6, and raises the median story from 639 ms to 877 ms. The same 541 stories with stability on take 175 s, down from 459 s.

**Not using the baseline to shorten settling.** Considered and left out: a batch with a baseline could screenshot early, and stop as soon as a story matches its golden. Playwright 1.63.0's `expect(page).toHaveScreenshot()` works this way, retrying at 0, 100, 250, and 500 ms, though only through `@playwright/test`, comparing pixels against a file.

- **It saves little.** In the table above, removing the settle entirely took 83.5 s down to 78.0 s at 4 stories at a time, and at the default of 6, 66.1 s became 71.2 s, which is within the batches' spread, since the CPUs are the limit. Stopping early can't beat a settle of 0. A project with a much longer settle would save more.
- **It can hide a regression.** A page that briefly matches its golden, and then draws something wrong, would record as unchanged.
- **It makes pixels depend on the baseline**, so the same built Storybook could render differently from one baseline to the next, which sits badly with reusing a render of an unchanged build.
- **Comparing costs about what it saves.** The image hash means decoding each PNG in the worker, at roughly 10 ms an image, estimated from a review's 6 s store step over 541 stories rather than measured alone. Comparing PNG hashes would be cheaper, but the store keeps WebP, so it would need a column for each golden's PNG hash.

The reverse was left out too, for the same complexity: retrying a story that doesn't match, for a bounded time, to spare a slow page a false `changed`. Neither has a real project asking for it yet.

**An unread response.** With the fixture's `basic--serving` story not reading its `fetch` bodies, its requests stayed in flight in the container, under both `networkidle` and the request count. A plain Playwright script against `route.fulfill` or a real server didn't reproduce it, and the cause wasn't found. The wait is soft, so such a story is rendered late with a `timeout` error. No dormouse story did this.

**Play failures.** Storybook 11's bundle sets `throwPlayFunctionExceptions: false`. On a play failure it then runs the `errored` phase, logs the error, and continues to `completed`, so an `errored` check depends on when it polls. 2 of dormouse's 541 stories do this, and both report `play` errors.

## A story's viewport

**A new load, not a resize.** Polling every 1 ms on Dormouse's Storybook 11.0.0-alpha.8, 2026-11, the loaded story first appeared with the phase already `rendering`, so a resize can't get ahead of the mount, and would land at a different point in it from one render to the next. Resizing once the story finished would be steady, but its play function would have run at the wrong size, and whatever read the window as it mounted would keep what it read. It costs one more page load, only for a story that declares a size. A new context as well as a new page, since the first load can be stopped anywhere in writing to storage.

**The first load's errors go.** They're about a window this story's image wasn't taken in, and a story that throws at the wrong size is reporting nothing about the right one.

**A warning as well as an error.** A batch keeps only a story's `play` errors, so a `viewport` error alone would end with the manifest, and nobody reviewing would learn their phone story was rendered at desktop width. A warning also stops the render being reused (`docs/specs/cli.md` → Recording only if necessary), which is what keeps the warning coming: reuse wouldn't repeat it.

**Not the manager's fallback.** With options and an unknown name, the manager shows the first option, which reads as the story having asked for that. A wrong image that looks deliberate is the thing to avoid, and the environment's size is what the story would get with no declaration at all.

## Freezing timers

**How to find a story that isn't frozen.** Render it twice and compare. A built-in repeat pass did this until it was removed, since flagging unstable stories in the data, and deciding what that means, was more machinery than asking an agent to fix one. These measurements of it remain.

**Comparing PNG bytes.** Equal bytes always mean equal pixels, so bytes can't hide a difference. The only possible error is a false alarm, if one set of pixels could encode two ways. Across the earlier experiment's 59 batches and 1,016 renders, 233 distinct pixel hashes mapped one to one to 233 distinct PNGs. Chromium's PNGs carry no timestamp or text chunk, and `render/test/render.container.test.ts` checks this and that the same render matches byte for byte in the real container.

**Equal timing can miss a timer.** Two renders with equal timing called all 30 unfrozen sample stories stable in 4 of 4 batches, though two of them hold running timers: load timing is repeatable enough for a blink to land on the same phase each time. At the 100 ms settle, the second render needed about 730 ms more settling to catch both in every batch: 530 ms caught both in 0 of 4 batches, and 730 and 930 ms in 4 of 4, while 1130 ms caught both in only 2 of 4.

**Limits.** One app's stories, on one machine, so a timer whose period happens to fit the delay can still match. A fixture cycling every 700 ms did exactly that at 730 ms, so a match is not proof.

## A project's recipe

**The app decides, and the renderer adapts.** Measured on this repository's 134 stories, 2026-11: `loading="lazy"` and `decoding="async"` made images below the fold differ between renders. Changing the app would have fixed them here, and left every other project with the same flake and the advice to change how its product loads images. So the renderer loads and decodes them itself, and the app kept its attributes.

**Configurable, with new goldens.** A project may really want dark mode, its own locale, or its own origin. These are hashed, so changing one starts new goldens for that project alone, rather than reading as every story changing.

**What stays fixed.** A setting that would stop the worker answering every request, or that couldn't work in a container, isn't a choice a project can usefully make.

**What didn't work.** Rendering with `--disable-checker-imaging`, with and without `--num-raster-threads=1`, didn't stop images differing. Forcing a repaint after decoding, by hiding the root for a frame, made it much worse, with 14 of 23 stories differing rather than 3.

