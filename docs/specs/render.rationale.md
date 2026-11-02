# Render — Rationale

> Informative companion to [render.md](render.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative. The evidence for the environment itself is in [system.rationale.md](system.rationale.md). All measurements are from 2026-11, on dormouse's Storybook, on a local M4 Mac with Docker Desktop's 10-CPU VM.

## Environment

**`--disable-partial-raster`.** Before this flag, 2 to 7 of the 541 stories differed from an earlier run with their timers frozen, 12 distinct stories over 10 runs, by a few pixels each. Every difference inspected, on 5 of those stories, sat on an antialiased edge: rounded corners, diagonal strokes in icons, and one 1 px vertical line. Rendering 19 of the affected stories 6 times each, counting stories with more than one distinct PNG:

| Flags added | Stories that varied |
|---|---|
| None | 5 of 19 |
| `--disable-partial-raster` | 0 of 19 |
| `--num-raster-threads=1` | 8 of 19 |
| Both of those | 0 of 19 |
| `--disable-checker-imaging` | 7 of 19 |

With the flag, 7 full runs of all 541 stories, across the settle times, quiet periods, and concurrency below, were byte-identical on 541 of 541. The evidence fits Chromium re-rastering only part of a tile when a repaint lands after the first raster, so timing decides whether an edge is drawn whole or clipped, but Chromium's code wasn't read to confirm it.

**The flag's one-time cost.** It moved 19 of 541 stories compared with the same settings without it, by 350 pixels in total, at most 19 color levels. That happens once, under a new environment ID. The cross-machine table in [system.rationale.md](system.rationale.md) was measured without the flag, and has not been repeated with it.

**Housekeeping flags.** `--use-mock-keychain --password-store=basic` stop macOS keychain prompts. The container's PNGs were byte-identical with them and without them on 30 of 30 sample stories, so they don't belong in the ID.

**Settle time outside the ID.** With a project's timers frozen, settle times from 0 to 500 ms gave identical PNGs on all 541 stories, so tuning it shouldn't restart goldens. A story that does depend on it reports as changed, like any other project input.

## Capture

**Container isolation doesn't change pixels.** On the 30-story sample with its freeze, before the raster flag, this package's PNGs were byte-identical on 30 of 30 to an earlier experiment's. The experiment ran as root with `--ipc=host`, a writable root, Docker's default capabilities, no request blocking, a static server, and one story at a time.

**`route.fulfill` instead of a server.** PNGs stayed byte-identical on 30 of 30 sample stories when the static server was replaced. It removes the server, the port, and the MIME table, and a fixed origin keeps a story that reads its location the same in both runners.

**No byte cache.** Caching file bytes in the worker made no measurable difference, and needs a MIME table, since `route.fulfill` only infers a type from a path. All 541 stories at the adopted defaults, alternating:

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `fulfill({ path })` | 65.0 s | 75.4 s | 73.7 s |
| Byte cache | 68.0 s | 73.1 s | 73.6 s |

**Waits and concurrency.** All 541 stories with the freeze, one pass. With the flag, every run is byte-identical to the 500 ms settings on 541 of 541. "Quiet" is the network wait: Playwright's `networkidle` is a fixed 500 ms, and the others count in-flight requests.

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

"Differences, no flag" compares with one earlier full run, so it counts the partial raster variation, which is why it wanders. The adopted row is 100 ms, 100 ms, and 6 stories at a time, about 64% less time than where it started. Below that the time stops improving, since the CPUs become the limit, so 0 ms would give up the margin for nothing. Concurrency 8 is within the noise of 6, and raises the median story from 639 ms to 877 ms. The same 541 stories with stability on take 175 s, down from 459 s.

**An unread response.** With the fixture's `basic--serving` story not reading its `fetch` bodies, its requests stayed in flight in the container, under both `networkidle` and the request count. A plain Playwright script against `route.fulfill` or a real server didn't reproduce it, and the cause wasn't found. The wait is soft, so such a story is captured late with a `timeout` error. No dormouse story did this.

**Play failures.** Storybook 11's bundle sets `throwPlayFunctionExceptions: false`. On a play failure it then runs the `errored` phase, logs the error, and continues to `completed`, so an `errored` check depends on when it polls. 2 of dormouse's 541 stories do this, and both report `play` errors.

## Stability

**Comparing PNG bytes.** Equal bytes always mean equal pixels, so bytes can't hide a difference. The only possible error is a false alarm, if one set of pixels could encode two ways. Across the earlier experiment's 59 runs and 1,016 captures, 233 distinct pixel hashes mapped one to one to 233 distinct PNGs. Chromium's PNGs carry no timestamp or text chunk, and `render/test/capture.container.test.ts` checks both this and that repeat renders match byte for byte in the real container.

**Why the repeat settles longer.** Two passes with equal timing called all 30 unfrozen sample stories stable in 4 of 4 runs, though two of them hold running timers: load timing is repeatable enough for a blink to land on the same phase each time.

**530 ms no longer fits the shorter settle.** It was chosen against a 500 ms settle, where it caught both timer stories. At the 100 ms default, the first flip of `terminal-terminalpane--ansi-colors` comes at about 630 ms of settle, right where the repeat lands. On the unfrozen sample, 4 runs each:

| Extra settle | Runs catching both | Runs catching one | Runs catching neither | Frozen sample unstable | Sample time |
|---|---|---|---|---|---|
| 530 ms | 0 | 2 | 2 | 0 | 14.4 s |
| 730 ms | 4 | 0 | 0 | 0 | 15.7 s |
| 930 ms | 4 | 0 | 0 | 0 | 16.7 s |
| 1130 ms | 2 | 2 | 0 | 0 | 17.7 s |

**Limits.** One app's stories, on one machine, and stability is one repeat with one extra delay, so a timer whose period happens to fit the delay can still match. The fixture's `timers--ticking` tests a repeating timer, not this delay's exact value.
