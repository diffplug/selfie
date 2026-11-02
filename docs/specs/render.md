# Render

> Status: partly built — the `selfie-render` package captures a built Storybook and reports PNGs and stability. Nothing calls it yet; see `## Future`.
>
> - See `docs/specs/glossary.md` for image, snapshot, environment, and run.
> - Owns how a story becomes a PNG: the environment's shape and ID, capture, stability, the manifest, and the CLI. `docs/specs/system.md` → Rendering environments owns the rules this implements. `docs/specs/store.md` owns image identity and decoding.

## Environment

Source of truth: `render/src/environment.ts`, `render/src/worker/protocol.ts`; tests in `render/test/environment.test.ts`.

A `RenderEnvironment` is a typed object:

| Field | Default |
|---|---|
| `runner` | `{ kind: "container", image: "mcr.microsoft.com/playwright@sha256:a0f4…7bd5717", platform: "linux/arm64" }`, or `{ kind: "native", os, osRelease, arch }` |
| `browserFlags` | `--disable-lcd-text`, `--font-render-hinting=none` |
| `viewport` | 1200×900 |
| `scale` | 1 |
| `settleMs` | 500 |

- **Must refuse a container image with no `sha256` digest.** `name:tag@sha256:…` is accepted, and runs as `name@sha256:…`.
- **Must keep one ID format:** `container-<os>-<arch>-<hash>` or `native-<os>-<arch>-<hash>`, where the hash is 16 hex digits and the prefix is only for reading. `environmentId()` is what a snapshot's name will carry. Reserved: see [Snapshot integration](#snapshot-integration).
- **Must hash everything that decides pixels:** the image digest and platform, or the native OS, OS release, and architecture; the browser flags; viewport; scale; `settleMs`; `CAPTURE_RECIPE`; and the Playwright version.
- **Never hash what can't change pixels:** an image's tag or registry, the order of flags, or the order of properties (rationale).
- **Must refuse a browser flag given twice**, since the ID sorts flags and Chromium's last duplicate wins.
- **Must keep fixed page conditions in `CAPTURE_RECIPE`, not in the environment:** locale `en-US`, timezone UTC, light scheme, reduced motion, a fixed `Date`, and the screenshot options. Must bump its `waitSequence` when the order of waits changes.
- **Must pass `--use-mock-keychain --password-store=basic` on every browser launch, and keep them out of the environment and its ID** (rationale).
- **Must refuse a native environment recorded on a different machine**, so its ID can't claim an OS it didn't run on. `{ kind: "native" }` in `defineEnvironment` means this machine.
- **Must warn on stderr and in the manifest's `warnings` that a native run's images won't match other machines.**

## Capture

Source of truth: `render/src/capture.ts`, `render/src/runners.ts`, `render/src/worker/worker.ts`; tests in `render/test/capture.container.test.ts`, `render/test/container-args.test.ts`, with the fixture in `render/test/fixtures/storybook/`.

- **Must capture the `type: "story"` entries of the build's `index.json`, sorted by ID.** Docs entries are never captured. A filter is a list of ID patterns where `*` matches any run of characters. A pattern that matches nothing is a manifest warning.
- **Must serve the build on loopback, from the same worker in both runners**, so the only difference between them is where the worker runs.
- **Must run a container with no network, no capabilities, a read-only root, read-only mounts except the output directory, a non-root user, and only `HOME` in its environment.** Never pass credentials or the host's environment into it.
- **Must run the image by digest with `--pull=never`, after pulling it once if absent**, so a run works offline once pulled and can't use a different image.
- **Must fail the run if the container's OS or architecture isn't the environment's platform.**
- **Must give each story a fresh browser context**, and block any request that leaves the loopback origin in both runners. A blocked request is reported on the story and doesn't fail it.
- **Must wait, in order, for:** the page load, Storybook's render phase, network idle, `document.fonts.ready`, `settleMs`, and two animation frames. Then it screenshots the viewport, never the full page, with `animations: "disabled"`.
- **Must bound every wait.** `storyTimeoutMs` (default 60 s) bounds a story from context to screenshot. Network idle alone is soft: it records an error after 15 s and captures anyway. The worker exits on its own at a deadline derived from the story count, so a container outlives no host process.
- **Must treat a story's failure as data.** A thrown render, Storybook's error display, or a timeout marks that story `failed` and the run continues. A browser crash relaunches the browser for later stories. A worker crash marks the unreported stories `failed`.
- **Must throw a `RenderError` only when no story could be attempted**, such as a missing `index.json`, an unavailable Docker, or a browser that won't launch.
- **Must clear only `manifest.json`, `stories/`, and `repeat/` in the output directory**, after Docker and the image are confirmed.
- **Must remove every container it starts**, on success, timeout, and abort. Each is `--rm` with a unique name, and is labeled `selfie-render=<output directory>`.

## Freezing timers

Source of truth: `render/src/worker/worker.ts`.

Browser options don't stop a project's own JavaScript timers. A project freezes them itself:

- **Must set `window.__SELFIE_SNAPSHOT__ = true` before any story code loads.** A project's code may test it to stop blinks and other timers.
- **May take an `initScript` and `initCss`**, both applied before story code runs, in every frame. This reaches a freeze the project already gates on its own name, such as `window.__ARGOS_SNAPSHOT__ = true;`.
- **Never put `initScript` or `initCss` in the environment ID.** They are project input like story code, so changing them reports changed stories rather than starting new goldens. The manifest records their SHA256.

## Stability

Source of truth: `render/src/capture.ts`, `render/src/manifest.ts`.

- **Must, when `stability` is set, render each story that succeeded a second time, in a new worker, settling 530 ms longer** (rationale).
- **Must compare PNG bytes** (rationale). A differing story is `unstable`, and its second render is kept at `repeat/<file>`. A story that fails its second render is also `unstable`. A story that failed the first time stays `unchecked`.
- **Must treat the first render as the result.** The longer settle is only ever used for comparing.

## Manifest

Source of truth: `render/src/manifest.ts`; tests in `render/test/manifest.test.ts`.

`manifest.json`, written atomically after the first pass and again after the repeat:

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `environmentId`, `environment`, `recipe` | What the pixels were asked to be |
| `runtime` | What ran: browser, Playwright, Node, OS, and architecture. Null if no story needed a browser |
| `launchArgs` | The browser's full flags, housekeeping included |
| `init` | The global's name, and the SHA256 of `initScript` and `initCss` |
| `stabilityChecked`, `startedAt`, `durationMs`, `warnings` | About the run |
| `totals` | Counts of `stories`, `ok`, `failed`, `stable`, `unstable`, `unchecked` |
| `stories[]` | `id`, `title`, `name`, `status`, `file`, `width`, `height`, `pngSha256`, `errors`, `stability`, `repeatFile`, `durationMs` |

- **Must write file paths relative to the manifest.** `file` is null on a failed story.
- **Must name a story's file `encodeURIComponent(id) + ".png"`**, since an ID comes from the build and may hold `/`.
- **`pngSha256` is not the image hash**, which `docs/specs/store.md` → Image identity defines over decoded pixels.
- **May report `errors` on an `ok` story:** console errors, page errors, and failed requests that didn't stop the render. Each has a `source`: `render`, `timeout`, `page`, `console`, `request`, `worker`, or `repeat`. A story keeps at most 20, each cut to 400 characters.

## API

Source of truth: `render/src/index.ts`, `render/src/cli.ts`.

The library exports `capture(options)`, `defineEnvironment(overrides)`, `environmentId(environment)`, `readStoryIndex(dir)`, `filterStories(stories, patterns)`, `ensureImage(runner)`, and the types above.

```
selfie-render capture <storybook-dir> --out <dir> [--story <pattern>]... [--stories-file <file>] [--stability]
    [--concurrency <n>] [--story-timeout-ms <n>] [--init-script <file>] [--init-css <file>]
    [--native] [--environment <file>]
selfie-render environment [--native] [--environment <file>]
```

`--environment` reads JSON overrides for `defineEnvironment`. `--concurrency` defaults to the machine's CPUs, at most 4, and is not part of the environment (rationale).

- **Must write exactly one JSON document to stdout, and human progress only to stderr.** `capture` writes `{ manifest, environmentId, totals, warnings }`, `environment` writes `{ environmentId, environment }`, and a failure writes `{ error }`.
- **Must exit 0 when every story rendered and none were unstable, 1 when the run finished but a story failed, was unstable, or none were selected, and 2 when the run couldn't happen.**

## Future

**Scope: cli-review** is defined in `docs/specs/system.md` → Build order. This package is its renderer, and nothing beyond that is built.

### Snapshot integration

- **`selfie review`** calls `capture`, and records its results in the local store with the environment in each snapshot's name (`docs/specs/system.md` → Environments in snapshots).
- **Decoding.** Turning a capture's PNGs into images belongs to `docs/specs/store.md` → Image decoding.

### Possible later work

- **Other images.** Only arm64 has a default. An x86-64 project today names its own digest and platform, and gets a different ID.
- **Project configuration.** Where a project keeps its environment, init script, and CSS. The CLI only takes them as files.
