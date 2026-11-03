# System — Rationale

> Informative companion to [system.md](system.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Rendering environments

**Measured 2026-11**, on 30 stories from dormouse's Storybook, with Playwright 1.63.0 and Chromium 153.0.8010.12, using dormouse's own rendering flags and timer freezes. Counts are identical image hashes.

| Comparison | Text shown | Text hidden |
|---|---|---|
| Docker arm64 on a Mac vs arm64 CI in the same image | 30/30 | |
| GitHub macOS 15.8.2 runner vs a second one | 30/30 | 30/30 |
| GitHub macOS 15.8.2 runner vs a local macOS 27 M4 | 0/30 | 30/30 |
| Native arm64 Linux runner vs a second one | 30/30 | 30/30 |
| Native arm64 Linux runner vs Docker arm64 on a Mac | 24/30 | 30/30 |
| Native arm64 Linux vs native x86-64 Linux | 15/30 | 17/30 |
| GitHub macOS runner vs native arm64 Linux | 0/30 | 24/30 |

**What decides the pixels.** Chrome for Testing is the same binary as Playwright's headless shell, and gave identical output. No Chromium flag tested closed any cross-machine gap, including `--disable-skia-runtime-opts`, `--force-color-profile=srgb`, and `--disable-font-subpixel-positioning`. Forcing one font on every element didn't either. Text is the main difference, and the x86-64 difference is mostly 1 color level per channel, on the same 15 stories natively and under emulation. Emulated x86-64 in a container matched native x86-64 in the same image 30/30.

**Limits.** One app's stories, and each hardware type measured on one or two machines. GitHub's Macs are virtualized M1s, and a macOS version difference can't be separated from the M1 and M4 difference here. This table predates `--disable-partial-raster`, the default since [render.rationale.md](render.rationale.md) → Environment.

**Measured again 2026-11 with `--disable-partial-raster`**, on all 541 of dormouse's stories, through Selfie's real renderer and its default environment, comparing image hashes.

| Comparison | Identical images |
|---|---|
| Docker arm64 on a local M4 Mac, one run vs another | 541/541 |
| Docker arm64 on a GitHub arm64 runner vs a second one (Neoverse-N2) | 541/541 |
| Docker arm64 on a local M4 Mac vs on a GitHub arm64 runner, all four pairings | 541/541 |

All four runs reported the same environment ID and no failed stories. One run on each kind of machine also rendered each story twice, and all 541 matched.

**x86-64 emulating arm64 doesn't work yet.** On a GitHub x86-64 runner with QEMU, the same container started Chromium, then the browser closed on all 541 stories. The error kept only the start of the browser's log, so the cause is unknown. It was one attempt, under the renderer's locked-down container settings, and nothing else was tried.

**Timers.** Playwright's `animations: 'disabled'` and `caret: 'hide'` didn't stop a terminal cursor's JavaScript blink, which changed 2 of 30 stories between runs. Dormouse's render flag did. A blinking cursor can also match by luck, so one repeat that matches is weak evidence.
