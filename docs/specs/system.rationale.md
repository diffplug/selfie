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

**Limits.** One app's stories, and each hardware type measured on one or two machines. GitHub's Macs are virtualized M1s, and a macOS version difference can't be separated from the M1 and M4 difference here. An x86-64 machine emulating arm64 is untested.

**Timers.** Playwright's `animations: 'disabled'` and `caret: 'hide'` didn't stop a terminal cursor's JavaScript blink, which changed 2 of 30 stories between runs. Dormouse's snapshot flag did. A blinking cursor can also match by luck, so one repeat that matches is weak evidence.
