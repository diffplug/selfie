# Render — Rationale

> Informative companion to [render.md](render.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative. The evidence for the environment itself is in [system.rationale.md](system.rationale.md).

## Environment

**What stays out of the ID.** An image's digest fixes its content, so a tag or mirror of the same digest can't change pixels. Sorting flags means reordering a config doesn't restart a project's goldens.

**Housekeeping flags.** `--use-mock-keychain --password-store=basic` stop macOS keychain prompts. Measured 2026-11: the container's PNGs were byte-identical with them (this package) and without them (the earlier experiment) on 30 of 30 dormouse stories, so they don't belong in the ID.

**Fixed page conditions.** Hashing `CAPTURE_RECIPE` means editing a value restarts goldens by itself, without anyone remembering to.

## Capture

**Container isolation doesn't change pixels.** Measured 2026-11, on the 30-story dormouse sample with its freeze applied: this package's PNGs were byte-identical on 30 of 30 stories to the earlier experiment's. The experiment ran as root with `--ipc=host`, a writable root, Docker's default capabilities, no request blocking, and one story at a time. This package runs as non-root with `--shm-size=2g`, a read-only root, no capabilities, request blocking, and 4 stories at a time. That is also why concurrency stays out of the environment.

**Worker in the image's own Node.** The image ships Node 24 and browsers but no Playwright package. The worker is erasable TypeScript, run by Node's type stripping, with `playwright-core` mounted read-only from the host. So there is no build step and no second image, and the digest stays the only thing to pin. `playwright-core` is pinned exactly to the version the image's browsers belong to.

**Blocking requests natively too.** The container has no network, so a native run would otherwise see pages the container can't.

**Timing.** Measured 2026-11 on a local M4 Mac under Docker Desktop, 1200×900 at 4 stories at a time. The 30-story sample with the freeze: 27.5 s for both passes, with a median of 1.3 s per story. All 541 of dormouse's stories with the freeze: 459 s for both passes, with a median of 1.4 s per story and none failed.

**Play function failures.** A build can set `throwPlayFunctionExceptions: false`, and Storybook then logs a play failure and completes the render. That is why such a failure appears only as a console error on an `ok` story. Measured 2026-11: 2 of dormouse's 541 stories did this.

## Stability

**Comparing PNG bytes.** Equal bytes always mean equal pixels, so bytes can't hide a difference. The only possible error is a false alarm, if one set of pixels could encode two ways. Measured 2026-11, across all 59 runs and 1,016 captures of the earlier experiment: 233 distinct pixel hashes and 233 distinct PNGs, mapping one to one. Chromium's PNGs carry no timestamp or text chunk, and `render/test/capture.container.test.ts` checks both this and that repeat renders match byte for byte in the real container.

**The longer settle.** Measured 2026-11 on the 30-story dormouse sample without its freeze. Two passes with equal timing called all 30 stable in 4 of 4 runs, though the sample holds cursor stories: load timing is repeatable enough for a blink to land on the same phase each time. Each story's second render settling 200, 330, or 530 ms longer changed the same 2 stories (`app-copy-editor-placement--squished-beside` and `terminal-terminalpane--ansi-colors`), and 750 ms longer changed only one of them. With the freeze applied, settling 200 or 530 ms longer changed nothing on 30 of 30. 530 ms is near the half period of common caret blinks (500 to 600 ms), where a blink is most likely to have flipped. It costs about 0.5 s per story, in the repeat only.

**Instability beyond timers.** Measured 2026-11 on all 541 dormouse stories with the freeze: 536 stable and 5 unstable, each differing by 1 to 72 pixels, usually by 1 to 6 color levels and at most 19. The longer settle does not explain it: rendering those 5 four times at each of 500 and 1030 ms gave 2 of them two distinct PNGs at both settle times, 1 two PNGs at 1030 ms only, and 2 one PNG throughout. So a few stories vary slightly from run to run in the pinned container. The cause wasn't investigated. It matters to anything comparing exact image hashes, about 1% of this app's stories here.

**Limits.** One app's stories, on one machine, and stability is one repeat with one extra delay, so a blink whose period happens to fit the delay can still match, and an occasional variation can be missed. The fixture's `timers--ticking` tests a repeating timer, not this delay's exact value.
