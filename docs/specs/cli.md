# CLI

> Status: built — the `selfie-cli` library and the `selfie` binary: `review`, `approve`, `reject`, and `ui`, on the local store. `docs/specs/sync.md` owns `push`, `pull`, and what a remote adds; see `## Future`.
>
> - See `docs/specs/glossary.md` for batch, render, reference, baseline, decision, and environment.
> - Owns local data's layout, each command's checks and exit code, and the shape of what they print and return. `docs/specs/renders.md` owns what a batch, a decision, and an approval are. `docs/specs/render.md` owns render. `docs/specs/store.md` owns images.

## Commands

Source of truth: `cli/src/cli.ts`, `cli/src/document.ts`; the real binary's tests are in `cli/test/binary.test.ts`. `selfie --help` lists every flag.

| Command | Does |
|---|---|
| `selfie` | Opens every story of a built Storybook, running, to look at, save, and write notes on, or says how to get there ([selfie alone](#selfie-alone)) |
| `selfie render` | Always renders a built Storybook and records a batch, and judges nothing |
| `selfie flakes` | Renders a built Storybook several times, and prints what wasn't the same each time ([Flakes](#flakes)) |
| `selfie skill <name>` | Prints a guide for a coding agent ([Flakes](#flakes)) |
| `selfie review [<batch>]` | Prints the diff of a batch against what history has approved. With no batch, uses the one for this built Storybook, and records one [only if necessary](#recording-only-if-necessary) |
| `selfie approve <batch>`, `selfie reject <batch>` | Records a decision on what a batch changed, added, or removed, with `--all` or `--story <pattern>` |
| `selfie push`, `selfie pull` | Sends a batch to a remote, and takes the decisions a commit reaches from one (`docs/specs/sync.md`) |
| `selfie notes` | Prints the open notes a person has sent to an agent from this folder (`docs/specs/feedback.md`) |
| `selfie reply <note> <text>` | Answers a note (`docs/specs/feedback.md`) |
| `selfie agent-await-feedback` | Blocks until a person sends notes from this folder (`docs/specs/feedback.md`) |
| `selfie ui [<batch>]` | Serves the review UI until stopped, and prints its URL ([ui](#ui)) |

- **Must print exactly one document on stdout, whatever happens,** and everything for people on stderr, including a review's one line of timings. A command that couldn't run prints `{ "error": { "code", "message" } }`. `--help` prints usage.
- **Must use these exit codes:**

| Code | Meaning | Examples |
|---|---|---|
| 0 | Nothing blocks | A review with no blockers, a batch recorded, even with failed stories, a decision recorded, `ui` stopped by a signal |
| 1 | The command ran, and something blocks | A review listing anything in `blockers`, or showing any difference from a `--baseline`, a `--story` pattern on `approve` or `reject` that matched nothing |
| 2 | The command couldn't run | Not a Git repository, no commits, no Storybook, no Docker, no `selfie.config.json`, a store from before a schema change, a failed `--build`, a bad flag, an unknown batch, `--story` matching no story at all, a `ui` that can't start |
| 3 | Nothing yet, and it's worth asking again | `agent-await-feedback` past its `--timeout` |
| 130 | Stopped by a signal, where stopping isn't success | `agent-await-feedback` |

- **Must take a story pattern as `docs/specs/render.md` → Render defines it:** an ID, where `*` matches any batch of characters.

## Library

Source of truth: `cli/src/index.ts`; tests in `cli/test/library.test.ts`.

`selfie-cli` exports what a UI needs, in plain data with no printing and no exit codes:

| Export | Does |
|---|---|
| `openProject({ cwd, env })` | The repository's `Project`: its `repo`, `directory`, `renders`, `notes`, `store`, `renders`, and `close()` |
| `renderBatch(project, options)` | Returns a `RenderBatchResult`: the `batch`, `dirtyPaths`, `warnings`, and `timings`. `options.onProgress` is `render`'s (`docs/specs/render.md` → Render) |
| `review(project, options)` | `options` is a `batch`, or what `renderBatch` takes. Returns a `ReviewResult`: the `comparison`, `given`, `dirtyPaths`, `differences`, `failures`, `warnings`, and `timings` |
| `decide(project, { batchId, decision, actor, stories })` | `stories` is `"all"`, patterns, or `{ targets }`: exact stories and image hashes, for a caller that showed them, refused whole with `stale-decision` if any isn't a changed or added image the batch holds, or a removed story of it, with a null hash. Returns `decided`, `skipped`, `unmatchedPatterns`, and the `comparison` after it. It compares twice, and reads unchanged rows only for patterns |
| `summarizeBatch(comparison)` | Returns `blockers`, `counts`, `inFilter`, `undecided`, `unapproved`, `failed`, `removed`, and `notRendered` |
| `isDecidable(state)` | Whether a render in this state can take a decision: `changed` or `added`. Defined in `selfie-store` |
| `compareAsReviewed(project, batchId, options)` | A batch compared with what history has approved |
| `resolveRenderSettings(repo, { native })`, `gitUserEmail(repo)` | What the commands use for these |
| `readReviewCache(project, batchId)` | The paths and pixel diffs a review exported, or null once pruned |
| `SelfieError` | Has a `code`, so a caller can tell cases apart without reading its message |

- **Must keep facts in results and compute verdicts.** A result never says what needs attention: `summarizeBatch` does, from a comparison, so a verdict can be recomputed after any decision.
- **Must keep command wording out of results.** `next` steps and refusal messages are built in `cli/src/document.ts`, and a refusal holds fields such as `stories` and `outsideFilter`.
- **Must keep printing and exit codes in `cli/src/cli.ts`.**
- **Must take the types the review UI also reads from `selfie-ui/app`, with `import type`**, so each has one definition and nothing is loaded for them: `PixelDiff`, `Attention`, and the reasons.

## Local data

Source of truth: `cli/src/paths.ts`, `cli/src/project.ts`; tests in `cli/test/units.test.ts`.

`<home>` is `$SELFIE_HOME` if set, and otherwise `~/.config/selfie`.

```
<home>/<slug>/
  store.db                               SQLite, per docs/specs/store.md, with tables of its own (Recording only if necessary, and docs/specs/feedback.md)
  blobs/images/<image hash>              Filesystem blobs, per docs/specs/store.md
  notes/<image hash>[-<box>].png         What a note is about, with its box drawn on it
  batches/<batch id>/review.json              A disposable cache of exported paths and pixel diffs
  batches/<batch id>/stories/<name>/*.png     current, golden, and diff
  batches/<batch id>/against/<baseline>/stories/<name>/*.png     the same, for a --baseline
  render/<uuid>/                        One render's output, deleted when recording ends
```

- **Never read `<home>/d1.env`**, or anything else in `<home>` that isn't under a project's slug.
- **Must make a slug of only `[a-z0-9-]`**, so it holds no separator or dot, can't climb out of `<home>`, and can't be a file there such as `d1.env`. It is the readable origin, cut to 80 characters, then 8 hex digits of the normalized origin's SHA256, so `a/b-c` and `a-b/c` stay apart.
- **Must normalize an origin to its lowercased host and path, with no scheme, credentials, port, trailing slash, or `.git`**, so an SSH and an HTTPS clone share a store, and a token in a URL reaches no path, document, or log. The origin goes no further than the slug.
- **Must use `local-<16 hex digits>` of the Git common directory for a repository with no origin**, so its worktrees share a store.
- **Must create a project's directory private to its user**, since it holds screenshots of what may be a private repository.

## Review

Source of truth: `cli/src/review.ts`, `cli/src/diff.ts`, `cli/src/hunks.ts`, `cli/src/explain.ts`, `cli/src/png.ts`; tests in `cli/test/commands.test.ts` with a stand-in for `render`, and `cli/test/review.container.test.ts` with the real one.

A review of a named batch starts at step 6. `selfie render` is steps 1 to 5, always renders, and prints what it recorded. Otherwise, in order, a review:

1. With `--build`, runs the config's `buildCommand` in a shell. Its stdout goes to stderr. **Never guess a project's build system.** **Never use a shell for anything else.**
2. Reads HEAD and the working tree.
3. Unless that exact built Storybook [already rendered](#recording-only-if-necessary), renders the config's `storybookDir` in a new render directory, with `--story` patterns, and the project's [init script](#configuration).
4. Checks HEAD didn't move.
5. Unless a batch [already says all this](#recording-only-if-necessary), begins a batch recording whether the tree was dirty, its branch, and any filter. Stores each PNG with `Store.putImages`, which keeps new ones as WebP, or takes an earlier render's rows, and records and finishes the batch with `RenderBatches`. Rows carry the failure message and the `play` error.
6. Compares the batch with `--baseline`, or else what history has approved (`docs/specs/renders.md` → Approvals).
7. Exports images and pixel diffs for what isn't unchanged, writes `review.json`, and prunes [output](#output-directories).

- **Must take `blockers`, `counts`, and the exit code from what this review compared with**, so a `--baseline` answers its own question, and says nothing about what history has approved.
- **Must refuse a named batch with any flag for making a batch**, since it's already recorded.
- **Must take `--baseline` as a batch ID, or else anything Git resolves to a commit, whose ancestors' approvals it means**, and fail with exit 2 if there's no such finished batch in this environment or no such commit.
- **Must keep `--baseline` to this one review.** It changes nothing about the batch: `selfie approve` still compares with what history has approved, its exports go under `batches/<batch id>/against/<baseline>/`, and `review.json` isn't written. It exits 1 if anything differs, even when every image is approved, since the question was what differs (rationale).
- **Must do diff work only on a `changed` render.** An `added` or `removed` one exports its one image, and an unchanged one nothing. A failed one exports the image it left, if it rendered that far.
- **Must write every exported image as a PNG, whatever the store keeps**, so a document's paths stay what they say and any agent can open them.
- **Must report what changed as hunks:** rectangles of each image that correspond and differ, with everything outside them matching once what's between them is lined up, found by a recursive 9-slice in `cli/src/hunks.ts` (rationale).
- **Must make hunks depend on the two images alone**, so the same pair always gives the same hunks, and a decision or a cache can rely on it.
- **Must keep `hunkMergeDistance` to grouping what's shown**, as `hunkGroups` in the document, and never let it change a comparison, a diff image, or what a decision is on (rationale).
- **Must say what each hunk's difference is, as its `kind`: `moved`, `spacing`, or else `changed`**, worked out in `cli/src/explain.ts` from the two images alone (rationale).
- **Must call content moved only if an identical block of it is in the golden, at least 9 pixels of it, each block used once, wherever in the image it was**, since what went sideways is two hunks: one that lost it, and one that gained it (rationale).
- **Must call rows spacing only if they're one color all the way across, that color is the image's background or the row just outside the hunk, and there are no more of them than the hunk's two sides differ in height by**, so a new solid banner is `changed` (rationale).
- **Must count as changed whatever moves and spacing don't account for: any pixel that comes out different when the current side is rebuilt from what was matched, and all of what the golden had that matched nothing**, so that nothing can vanish by being called moved.
- **Must claim a hunk's moves only if that leaves fewer pixels unexplained than comparing it in place, and must then not let any other hunk use its blocks** (rationale).
- **Must never let `kind` change what blocks, or what a decision is on.** A render with only moves and spacing needs a decision like any other (rationale).
- **Must compare a hunk in place from its top left, past spacing, and count what only one image has as changed**, whether rows or columns, so images of any two sizes have stats and a diff image.
- **Must mark a seam for a hunk with nothing different in the current image, because something was only taken away**, one row where it was, in the color of what happened to it, so every hunk has a place in the current image.
- **Must make the diff image from the current image, faded to light gray, with changed pixels solid `#ff0050`, what moved tinted `#0969da` both where it landed and where it left, and spacing solid `#ffd666`.**
- **Must treat a render's unusable file as that story's failure**: a manifest path outside the render directory, a path that isn't a regular file, or a PNG the store refuses. Other stories continue.
- **Must fail with exit 2 if HEAD moves during the render, or if no story was rendered**, since one Git SHA must describe the batch, and a typo must not pass.
- **Must record a batch as dirty if the tree had changes either before or after the render.** Ignored files don't count, so a gitignored `storybook-static` doesn't dirty the tree, and neither does a stale one (rationale).
- **Must not call a story removed when `--story` left it out.** Such stories are counted in `filter.notRendered`, and are not in `differences`, `counts.removed`, or `blockers`, and take no decision. A removed story matching a pattern still is.

### What blocks

Source of truth: `summarizeBatch` in `cli/src/summary.ts`.

- **Must exit 1 if `blockers` isn't empty.** Each entry has a `story`, a `reason`, and a `detail` holding the fact behind it, if there is one:

| List | `reason` | When | `detail` |
|---|---|---|---|
| `blockers` | `failed` | The story failed to render, its image was unusable, or its `play` function threw (rationale) | The failure, such as `play: …` |
| | `changed-unapproved`, `added-unapproved` | Its image has no decision | |
| | `rejected` | Its image is rejected | The actor |
| | `removed` | It has a reference, this batch doesn't have the story, and that has no approval | |
| | `pattern-unmatched` | A `--story` pattern matched nothing, while another did. `story` is null | The pattern |

- **Must not list what's approved**: it is still in `differences`, with its `decision`, for the batch it was approved on. A later batch finds it as the reference (`docs/specs/renders.md` → Approvals).

### Recording only if necessary

Source of truth: `replay` and `renderFresh` in `cli/src/review.ts`, `renderIdentity` in `render/src/identity.ts`; tests in `cli/test/reuse.test.ts`, `render/test/identity.test.ts`.

A review recognizes a built Storybook that already rendered, and skips rendering and storing. Otherwise it records that render's image hashes and `play` errors in a new batch. Everything else about a review stays: the batch has this review's Git SHA, dirtiness, branch, and filter, and it compares, exports, exits, and can be decided on like any other. Docker isn't needed for this, since nothing starts.

- **Must show the existing batch and record nothing when one at this commit came from that render with the same dirtiness, branch, and filter** (rationale).
- **Must recognize a built Storybook only by `renderIdentity` (`docs/specs/render.md` → Render identity)**, of the config's `storybookDir` after any `--build`, with the environment and the init script.
- **Never reuse a batch where a story has no image**, including an image the store refused, however many times it fails (rationale).
- **Never reuse a batch where any story has an error other than `play`, `console`, `page`, or `viewport`, or where render warned of anything** (rationale). Those are the project's own code, so the same built Storybook repeats them, and reuse keeps a `play` failure as a failure. A `viewport` error always comes with a warning, which reuse wouldn't repeat. Everything else, such as `request` and the soft `timeout`, might not happen next time.
- **Must keep only the newest real render of a built Storybook, and forget the built Storybook if that render can't be reused**, so a forced render that fails isn't hidden by an older one that passed.
- **Must not remember a render if the built Storybook's identity changed while it rendered**, since nothing describes those images.
- **Must always name a batch that really rendered:** a reused batch is never itself remembered, so reuse doesn't chain.
- **Must answer a filtered review only from the built Storybook's whole batch, by the filter, and never remember a filtered render or forget one because of it.** `filter`, `warnings`, and `blockers` come out as a render's would, and a filter matching nothing still exits 2.
- **Must always render in `selfie render`.** That render still updates what's remembered, so it is also how to replace one, and a later review shows the batch it recorded.
- **Must make it visible:** `batch.reusedFromBatch` (`docs/specs/renders.md` → Render batches), which is `reusedFromBatch` in `review`'s document; one line on stderr; and the batch screen (`docs/specs/ui.md` → Screens).
- **Must say why on stderr when a plain render of every story can't be reused**, naming the story and the error, since that's how a project finds out why it never hits.
- **Must keep the built Storybook that rendered each new batch, reused or filtered or failed or not, named by `storybookHash` (`docs/specs/render.md` → Render identity), unless it changed while it rendered**, so `selfie ui` can open the very build that rendered a batch (`docs/specs/store.md` → Built Storybooks, rationale).
- **Must keep the bytes it read for that hash**, so a built Storybook rewritten meanwhile can't be kept under another's name, **and must not fail a batch for failing to keep its built Storybook**, since the batch is sound, and only its stories' links are lost.
- **Must keep what's remembered in one table in the local `store.db`, `render_keys(key, batch_id)`, reached only through `Project.renders`' `find` and `remember`, and out of the store's schema**, so D1 has no counterpart and a pruned `review.json` loses nothing.

### The document

Every path is absolute, and names a file that exists until it is pruned.

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `batchId`, `gitSha` | The batch, and what it was recorded against |
| `reusedFromBatch` | The batch that really rendered these images, or null if this one did ([Recording only if necessary](#recording-only-if-necessary)) |
| `dirty` | Whether the tree had changes when the batch was recorded |
| `dirtyPaths` | Up to 20 of those changes. Empty for a named batch, since only the fact is stored |
| `comparedWith` | What this review compared with: `source`, one of `approvals` or `given`, and with `given` its `sha`, or its `batch` if it's a batch |
| `environment` | Its ID |
| `filter` | `patterns` and `notRendered`, or null with no `--story` |
| `counts` | `stories`, `unchanged`, `changed`, `added`, `removed`, and `undecided` |
| `blockers[]` | `story`, `reason`, `detail` |
| `differences[]` | `story`, `state`, `decision`, `imageHash`, `goldenHash`, `current`, `golden`, `diff`, `pixelDiff`, `hunkGroups` |
| `failures[]` | `story`, `failure`, and `current`, the image it left, or null |
| `warnings[]` | The manifest's |
| `next[]` | What to do next, in words and commands |

`pixelDiff` is `{ current, golden, hunks, changedPixels, movedPixels, spacingPixels, totalPixels, boundingBox, firstChanged, maxChannelDelta }`, where `current` and `golden` are each image's `width` and `height`, each of `hunks` is `{ current, golden, kind, changedPixels, moved }`, each of whose `current` and `golden` has that image's `x`, `y`, `width`, and `height`, and each of whose `moved` is `{ current, golden }`, the box of a block that landed in this hunk and the box it was in. A hunk that only lost something to another hunk is `moved` with no `moved` entries. `totalPixels` is the larger image's, `changedPixels` includes what only the golden has, `movedPixels` counts what landed, `spacingPixels` counts both sides' spacing, `boundingBox` and `firstChanged` are of changed pixels, or of the hunks if none changed, `firstChanged` is in reading order, and `maxChannelDelta` is 0 if no pixel compared. It is null unless `changed`. `hunkGroups` is `{ current, golden, kind }`, where `kind` is the most that any of the group's hunks is: `changed`, then `moved`, then `spacing`.

- **Must keep a difference's hashes**, so a UI can cache images by content.

## Output directories

Source of truth: `cli/src/project.ts`.

- **Must keep every fact about a batch in the store**, so that deleting a batch directory loses nothing but the exported files: a pruned batch can be decided on, and its images come from `Store.getImage`.
- **Must give each review its own render directory and batch directory, named by UUID**, so concurrent reviews can't touch each other's files.
- **Must delete a render directory when its review ends, however it ends.** A later review deletes one over 24 hours old, left by a crash.
- **Must keep the newest 20 batch directories, and delete older ones at the end of each review** (rationale). A batch is never deleted from the store, per `docs/specs/renders.md` → Open questions, and an image's blob stays with it.
- **Must write `review.json` atomically.** It holds exported paths and pixel diffs, which are all it can lose.

## Approve and reject

Source of truth: `decide` in `cli/src/decisions.ts`.

- **Must decide on exactly the batch's `changed`, `added`, and `removed` renders selected by `--all` or `--story`, and require exactly one of those.** Unchanged images get no decision. Failed ones have no image, and are listed under `skipped`. A story its filter left out isn't selected.
- **Must work on a dirty tree**, so a user can approve work before committing it (`docs/specs/renders.md` → Approvals).
- **Must take the actor from `--actor`, or else `git config user.email`**, and fail if there's neither.
- **Must record each decision at the batch's commit**, and compare against what history has approved (`docs/specs/renders.md` → Approvals).

It prints `batchId`, `decision`, `actor`, `decided`, `skipped`, `undecided` (what still has no decision), and `unmatchedPatterns`.

A first batch needs every image approved: `selfie approve <batch> --all`. That's all it needs, on any branch.

## Git

Source of truth: `cli/src/git.ts`; tests in `cli/test/git.test.ts`, on real Git repositories.

- **Must run Git only by argument arrays, never through a shell.**
- **Must choose the default branch as the first of these that exists:** `origin/HEAD`'s target, `origin/main`, `origin/master`, local `main`, local `master`.

## ui

Source of truth: `cli/src/ui.ts`, and `selfie ui` in `cli/src/cli.ts`; tests in `cli/test/ui-*.test.ts`. `docs/specs/ui.md` owns what it serves.

- **Must print `{ url, port, batchId, storybookUrl }` once it is listening, then keep serving until a signal**, and exit 0. `batchId` is the batch it was asked to open, or null.
- **Must host the built Storybook the other commands would render, and the kept built Storybooks, on a free port of its own** (`docs/specs/ui.md` → Routes), whether or not there's a built Storybook yet.
- **Must take an optional batch**, and refuse a bad or unknown one with exit 2 before listening. With none, the page opens at every story (`docs/specs/ui.md` → Screens), in this project's environment, or `--native`'s.
- **Must ask the system for a free port unless given `--port`**, so two projects can both be served.
- **Never open a browser.** Whoever ran it decides what to do with the URL. [`selfie` alone](#selfie-alone) is the one that does.
- **Must load `selfie-ui` and Hono only in the commands that serve**, by a dynamic `import()`, so no other command pays for a web server. `cli/test/ui-*.test.ts` checks what `cli/src/cli.ts` loads.
- **Must fail with `ui-not-built` and exit 2 if the client isn't built**, saying what to run: `pnpm --filter selfie-ui build`. `pnpm install` builds it, through `prepare`.
- **Must take a decision's actor from `git config user.email`, or refuse with `no-actor`.** There's no `--actor` here, since a page has no way to be anyone else.

## selfie alone

Source of truth: `openEveryStory` in `cli/src/cli.ts`; tests in `cli/test/ui-*.test.ts`. `docs/specs/feedback.md` owns what happens to a note.

It's [`selfie ui`](#ui) with no batch, except as below.

- **Must run the config's `buildCommand` first, once, unless `--no-build`** ([Configuration](#configuration)).
- **Must serve anyway if there's no built Storybook after that**, saying so on stderr, since the page says what to do (`docs/specs/ui.md` → Screens). A build command that fails still fails with `build-failed` and exit 2.
- **Must open a browser at its URL if it's at a terminal, unless `--no-open`, and never for anything else**, such as an agent or a script (rationale).
- **Must say on stderr what address it's serving**, since a browser may not open.

## Flakes

Source of truth: `cli/src/flakes.ts`, `cli/src/skills.ts`, `cli/skills/`; tests in `cli/test/flakes.test.ts`.

`selfie flakes [--times <n>] [--concurrency <n>]`, with `render`'s options for what to render.

- **Must record no batch and store nothing**, so it can't change a review. It keeps each render's images in `<project>/flakes/`, for looking at, until the next time it runs.
- **Must take at least 2 renders, and 3 by default.**
- **Must say how each render is going on stderr, at most every 10 seconds,** in the words of `describeRenderProgress` (`docs/specs/ui.md` → Screens), so stdout stays one document.
- **Must exit 0 if nothing is reported, and 1 if anything is**, printing `{ schemaVersion, environment, renders, stories, flaky, warnings, directory }`, with `flaky` biggest pixel difference first, since what's biggest most often has one big cause.
- **Must report a story whose images differ, or that failed in any render, or with a `timeout` or `request` error in any render, or with any other error in only some renders** (rationale).
- **Must compare by pixels**, naming the most different pair and a picture of what differs.

`selfie skill` prints a guide for a coding agent, in the format of an agent skill, so it works for a project that only has the CLI. `selfie skill quickstart` sets Selfie up in a repository, and `selfie skill fix-flakes` is how to use the above. This repository links the same file from `.claude/skills/`.

- **Must keep a skill's text in `cli/skills/<name>/SKILL.md`, as the one copy.**
- **Must say only what's been seen to work:** a row in a skill's table comes from a real case (rationale).

## Configuration

Source of truth: `cli/src/config.ts`.

`selfie.config.json` at the Git top level is the only place a project configures Selfie. `selfie` alone, `render`, `review`, `flakes`, `ui`, `push`, and `pull` require it:

| Key | Meaning |
|---|---|
| `environment` | Overrides for `defineEnvironment`, including its `recipe` (`docs/specs/render.md` → Environment) |
| `initScript` | A file inside the Git top level, used as `render`'s `initScript` |
| `storybookDir` | Required. A directory inside the Git top level, the built Storybook to render |
| `buildCommand` | Required. How this project builds its Storybook, run from the Git top level |
| `settleMs` | How long to wait after the network, images, and fonts, before a screenshot. Default 100. Changing it renders again |
| `storyTimeoutMs` | The bound on one story, from opening its context to its screenshot. Default 60000 |
| `hunkMergeDistance` | How close changed hunks group for showing, in CSS pixels, multiplied by the batch's scale. Default 12 |

- **Must refuse, with exit 2, a repository with no config, or one missing a required key**, and show what to write, and that `selfie skill quickstart` is a guide for a coding agent (rationale).
- **May let `--native` win over its `runner`.**
- **Never take a flag or environment variable for anything about the project.** Those describe this machine or this one command, such as `--native`, `--story`, and `SELFIE_HOME`, or a server, as `--remote` does (`docs/specs/sync.md` → Commands) (rationale).
- **Must refuse an unknown key**, so a typo can't silently render the wrong environment.
- **Must run `buildCommand` only when a person asks: `selfie` alone, or `--build` on `render`, `review`, or `flakes`, and never from a page or by default**, printing it first, so a checkout can only run a command on someone who asked for its built Storybook (rationale).

## Untrusted input

Source of truth: `cli/src/paths.ts`.

Story IDs come from a project's built Storybook, and a manifest's paths from a directory its worker can write.

- **Must make a story's directory name only `[A-Za-z0-9_-]`, cut to 80 characters, followed by 10 hex digits of the ID's SHA256**, so it can't climb out, and IDs differing only by case or punctuation stay apart on any filesystem.
- **Must read a render's file only if it lies under the render directory and is a regular file, not a symlink.**
- **Must refuse a batch ID that isn't a lowercase UUID before it reaches a path.**

## Future

### Hunks

- Decisions on them (`docs/specs/renders.md` → Future).
- Content that moved inside something with a fill of its own, such as text in an input in a modal, still ghosts: the input's borders keep its rows from being flat, and its fill isn't the image's background, so no block of the text comes out identical. A scrolled pane does too, since what's cut off at its edge differs.
- With no row unique to anchor on and two different heights, the 9-slice stops, so a page of identical rows whose height changed is one hunk, however far apart its changes are. Its moves and spacing are still told apart inside it, but they can't be selected or decided on separately.
- Pixels alone can't tell that a button's four rounded corners are one thing. The renderer could record each element's box, so hunks snap to them, at the cost of tying the differ to the browser.

### A render that does change

[Recording only if necessary](#recording-only-if-necessary) is all or nothing, so one changed file renders every story, and the time around a render is unchanged:

- A cache from PNG bytes to image hash, since decoding and hashing unchanged images is most of a review's non-render time.
- A diff cache by hash pair. It would save about 1 s on a reused batch with 80 changes (rationale).
- Reusing only the stories a change can reach.

### Rows copied by a reused batch

A reused batch at a new commit writes every row again, about 450 to 670 MB of `store.db` a year at 50 hits a day on 541 stories (rationale). Two ways to fix it, neither built: a reused batch could hold no rows and read through `reused_from_batch`, which every query on a batch's rows would have to learn (`docs/specs/renders.md` → Storing only what changed is the same idea); or a review could delete the rows of an earlier reused batch at the same SHA and environment that nothing decided from, which needs `docs/specs/renders.md` → Open questions' retention rule first.

### Open questions

- **A stale gitignored build.** Nothing ties a built Storybook to the commit it came from, so a clean tree with an old `storybook-static` records the old pixels against the new SHA. `--build` avoids it, and only a hash recorded at build time would catch it.
- **Two Storybooks in one repository.** They share a slug and an environment, so their story IDs share names, and neither can render without the other reading as removed.
