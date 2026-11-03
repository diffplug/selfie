# Render

> Status: partly built — the `selfie-render` library captures a built Storybook and reports PNGs. `selfie review` calls it (`docs/specs/cli.md`); see `## Future`.
>
> - See `docs/specs/glossary.md` for image, snapshot, environment, and run.
> - Owns how a story becomes a PNG: the environment's shape and ID, capture, and the manifest. `docs/specs/system.md` → Rendering environments owns the rules this implements. `docs/specs/store.md` owns image identity and decoding.

## Environment

Source of truth: `render/src/environment.ts`, `render/src/worker/protocol.ts`; tests in `render/test/environment.test.ts`.

A `RenderEnvironment` is a typed object:

| Field | Default |
|---|---|
| `runner` | `{ kind: "container", image: "mcr.microsoft.com/playwright@sha256:a0f4…7bd5717", platform: "linux/arm64" }`, or `{ kind: "native", os, osRelease, arch }` |
| `browserFlags` | `--disable-lcd-text`, `--font-render-hinting=none`, `--disable-partial-raster` (rationale) |
| `viewport` | 1200×900 |
| `scale` | 1 |

- **Must refuse a container image that isn't exactly `name@sha256:<digest>`**, including one that also has a tag.
- **Must keep one ID format:** `container-<os>-<arch>-<hash>` or `native-<os>-<arch>-<hash>`, where the hash is 16 hex digits and the prefix is only for reading. `environmentId()` is what a snapshot's name carries (`docs/specs/snapshots.md` → Snapshot names).
- **Must hash the image digest and platform, or the native OS, OS release, and architecture; the browser flags; viewport; scale; `CAPTURE_RECIPE`; and the Playwright version.**
- **Never hash an image's registry, the order of flags, or the order of properties**, since they can't change pixels.
- **Never hash `settleMs` or `initScript`.** They are project input like story code, so changing them reports changed stories rather than starting new goldens. The manifest records both (rationale).
- **Must refuse a browser flag given twice**, since the ID sorts flags and Chromium's last duplicate wins.
- **Must keep everything fixed that can decide pixels in `CAPTURE_RECIPE`**, which the worker reads directly: the origin, the snapshot global's name, headless mode, service workers, locale `en-US`, timezone UTC, light scheme, reduced motion, forced colors, a fixed `Date`, the network quiet period and its bound, and the screenshot options. **Must bump its `waitSequence` when the order of waits changes.**
- **Must pass `--use-mock-keychain --password-store=basic` on every browser launch, and keep them out of the environment and its ID** (rationale).
- **Must refuse a native environment recorded on a different machine**, so its ID can't claim an OS it didn't run on. `{ kind: "native" }` in `defineEnvironment` means this machine.
- **Must warn through `log` and in the manifest's `warnings` that a native run's images won't match other machines.**

## Capture

Source of truth: `render/src/capture.ts`, `render/src/runners.ts`, `render/src/worker/worker.ts`; tests in `render/test/capture.container.test.ts`, `render/test/container-args.test.ts`, with the fixture in `render/test/fixtures/storybook/`.

- **Must capture the `type: "story"` entries of the build's `index.json`, sorted by ID.** Docs entries are never captured. A filter is a list of ID patterns where `*` matches any run of characters. A pattern that matches nothing is a manifest warning.
- **Must answer every browser request in the worker, from the build directory, on the recipe's fixed origin.** No server listens. A path outside the build or missing from it gets a 404. The same worker runs in both runners, so the only difference between them is where it runs.
- **Must abort any request that leaves the origin, in both runners.** It is reported on the story and doesn't fail it.
- **Must check the runner before clearing any output:** a native environment against this machine, and for a container, Docker and the image on the declared platform, pulling it once if absent. That check compares the OS and architecture `docker image inspect` reports with the declared platform (rationale), so a digest for another platform is refused, and so is a multi-platform digest unless the declared platform is the host's. **Must use a single-platform digest for any other platform.**
- **Must run a container with no network, no capabilities, a read-only root, read-only mounts except the output directory, a non-root user, and only `HOME` in its environment.** Never pass credentials or the host's environment into it. It runs by digest with `--pull=never`, so it works offline once pulled and can't use a different image.
- **Must give each story a fresh browser context.**
- **Must wait, in order, for:** the page load, Storybook's render phase, no request in flight for the network quiet period, `document.fonts.ready`, `settleMs` (default 100 ms), and two animation frames. Then it screenshots the whole page, with `animations: "disabled"`, so an image is at least the viewport's size and may be taller or wider (rationale). Content in an inner scroller, or a layout fixed to the viewport's height, shows only what the viewport does.
- **Must not treat Storybook's `errored` phase as final.** A play failure passes through it on the way to `completed`, so the error display, `aborted`, and the timeout are what fail a story (rationale).
- **Must bound every wait.** `storyTimeoutMs` (default 60 s) bounds a story from context to screenshot. The network wait alone is soft and independent of it: it records an error after 15 s and captures anyway. The worker exits on its own at a deadline derived from the story count, so a container outlives no host process.
- **Must treat a story's failure as data.** A thrown render, Storybook's error display, or a timeout marks that story `failed` and the run continues. A browser crash relaunches the browser for later stories. A worker crash marks the unreported stories `failed`.
- **Must throw a `RenderError` only when no story could be attempted**, such as a missing `index.json`, a runner that can't run, or a browser that won't launch.
- **Must clear only `manifest.json` and `stories/` in the output directory.**
- **Must remove every container it starts**, on success, timeout, and abort. Each is `--rm` with a unique name and the label `selfie-render`.
- **May render at most 6 stories at once by default**, or fewer if the machine has fewer CPUs. Concurrency is not part of the environment (rationale).

## Freezing timers

Source of truth: `render/src/worker/worker.ts`.

Browser options don't stop a project's own JavaScript timers. A project freezes them itself:

- **Must set `window.__SELFIE_SNAPSHOT__ = true` before any story code loads.** A project's code may test it to stop blinks and other timers (rationale).
- **May take an `initScript`**, applied before story code runs, in every frame. This reaches a freeze the project already gates on its own name, such as `window.__ARGOS_SNAPSHOT__ = true;`, and can add a style.

## Manifest

Source of truth: `render/src/manifest.ts`; tests in `render/test/manifest.test.ts`.

`manifest.json`, written atomically once capture finishes:

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `environmentId`, `environment`, `recipe` | What the pixels were asked to be |
| `settleMs`, `initScriptSha256` | The project input that can also decide pixels |
| `runtime` | What ran: browser, Playwright, Node, OS, and architecture. Null if no story needed a browser |
| `startedAt`, `durationMs`, `warnings` | About the run |
| `totals` | Counts of `stories` and `failed` |
| `stories[]` | `id`, `title`, `name`, `status`, `file`, `width`, `height`, `pngSha256`, `errors`, `durationMs` |

- **Must write file paths relative to the manifest.** `file` is null on a failed story.
- **Must name a story's file `encodeURIComponent(id) + ".png"`**, since an ID comes from the build and may hold `/`.
- **`pngSha256` is not the image hash**, which `docs/specs/store.md` → Image identity defines over decoded pixels.
- **Must report a play function failure under the source `play`, from Storybook's `playFunctionThrewException` channel event, and keep `status: "ok"`**, since the story still rendered and has an image. The console error it also logs stays under `console`. `selfie review` lists the story as needing attention (`docs/specs/cli.md` → What blocks).
- **May report other `errors` on an `ok` story:** console errors, page errors, and failed requests that didn't stop the render. Each has a `source`: `render`, `timeout`, `play`, `page`, `console`, `request`, or `worker`. A story keeps at most 20, each cut to 400 characters.

## Render identity

Source of truth: `render/src/identity.ts`; tests in `render/test/identity.test.ts`.

`buildHash(storybookDir, onFile?)` returns a SHA256 of a build alone, or null if it's missing or holds a symlink, for naming the build that rendered a run. `onFile` sees the bytes it hashes. `renderIdentity({ storybookDir, environment, initScript })` returns one string that changes whenever a render of that build could change, for `docs/specs/cli.md` → Recording only if necessary to recognize it by. It lives beside `capture`, so a new capture option that can change pixels sits next to what it has to update.

- **Must depend on all of these, so that any one changing changes the identity:**

| Input | From |
|---|---|
| The build | A SHA256 of every file's relative path and bytes, sorted by path. **Never use a file's size or time** |
| The environment | Its ID |
| The init script | Its SHA256, or nothing if there's none. An empty script isn't no script |
| The renderer | A SHA256 of the package's own source, so a change to capture code or a default such as `settleMs` changes it in a checkout, where the package's version never changes |

- **Must leave out of the build's hash exactly this text, of exactly these files, and nothing by a pattern over paths**, since it differs between builds of one source, and nothing in a build loads these files (`docs/specs/cli.rationale.md` → Recording only if necessary):

| File, from the build's root | Text |
|---|---|
| `project.json` | A leading `{"generatedAt":<digits>,` |
| `manifests/components.html` | The first `Generation took <strong><number>s</strong>` |

- **Must return null for a native environment**, since its ID doesn't describe everything about its machine.
- **Must return null for a build holding anything but files and directories**, since what a symlink reaches isn't in its hash, and for one that's missing.

## API

Source of truth: `render/src/index.ts`.

`selfie-render` is a library, and `docs/specs/cli.md` is its CLI. It exports `capture(options)`, `renderIdentity(options)`, `defineEnvironment(overrides)`, `environmentId(environment)`, `filterStories(stories, patterns)`, which keeps whatever it is given that has an `id`, `unmatchedPatternWarning(pattern)`, `MANIFEST_FILE`, `RenderError`, `EnvironmentError`, and the types above. `selfie-render/testing` exports what a stand-in for `capture` needs in another package's tests, so that it can't drift from what `capture` writes. A native runner is `defineEnvironment({ runner: { kind: "native" } })`. `capture` writes human progress to its `log` option, which defaults to stderr.

## Future

### Possible later work

- **Named environments.** A project holds one environment, so one review can't capture both `desktop` at 1200×900 1× and `phone` at 390×844 2×, which a phone layout would want. Each story would then be rendered and approved once per environment. Runs and snapshot names already carry the environment, so this adds to the config and to `selfie review`, and leaves the store alone.
- **Other images.** Only arm64 has a default. An x86-64 project today names its own digest and platform, and gets a different ID.
