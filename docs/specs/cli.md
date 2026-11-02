# CLI

> Status: built — the `selfie-cli` library and the `selfie` binary: `review`, `approve`, `reject`, `accept`, `find-baseline`, and `ui`, on the local store. Nothing here reaches the cloud; see `## Future`.
>
> - See `docs/specs/glossary.md` for run, snapshot, golden, baseline, decision, and environment.
> - Owns local data's layout, each command's checks and exit code, and the shape of what they print and return. `docs/specs/snapshots.md` owns what a run, a decision, and a golden are. `docs/specs/render.md` owns capture. `docs/specs/store.md` owns images.

## Commands

Source of truth: `cli/src/cli.ts`, `cli/src/document.ts`; the real binary's tests are in `cli/test/binary.test.ts`. `selfie --help` lists every flag.

| Command | Does |
|---|---|
| `selfie review` | Renders a built Storybook, [only if necessary](#recording-only-if-necessary), records a run, and prints the diff against the baseline |
| `selfie approve <run>`, `selfie reject <run>` | Records a decision on a run's changed and new images, with `--all` or `--story <pattern>` |
| `selfie accept <run>` | Makes a run the goldens of its Git SHA |
| `selfie find-baseline` | Prints the baseline this repository and environment would use |
| `selfie ui [<run>]` | Serves the review UI until stopped, and prints its URL ([ui](#ui)) |

- **Must print exactly one document on stdout, whatever happens,** and everything for people on stderr, including a review's one line of timings. A command that couldn't run prints `{ "error": { "code", "message" } }`. `--help` prints usage.
- **Must use these exit codes:**

| Code | Meaning | Examples |
|---|---|---|
| 0 | Nothing blocks | A review with no blockers, a decision recorded, a run accepted, any `find-baseline` result, `ui` stopped by a signal |
| 1 | The command ran, and something blocks | A review listing anything in `blockers`, `accept` refusing, a `--story` pattern on `approve` or `reject` that matched nothing |
| 2 | The command couldn't run | Not a Git repository, no commits, no Storybook, no Docker, a failed `--build-command`, a bad flag, an unknown run, `--story` matching no story at all, a `ui` that can't start |

- **Decision for the user to review: advisories don't change the exit code.** A project with two known `play` errors can reach exit 0, so 1 keeps its meaning of "something here stops you". It also means **an agent checking only the exit code won't see a `play` failure or an unstable story**: it has to read `advisories`, which is why the document always carries the list and its count ([What blocks](#what-blocks)) (rationale).
- **Must take a story pattern as `docs/specs/render.md` → Capture defines it:** an ID, where `*` matches any run of characters.

## Library

Source of truth: `cli/src/index.ts`; tests in `cli/test/library.test.ts`.

`selfie-cli` exports what a UI needs, in plain data with no printing and no exit codes:

| Export | Does |
|---|---|
| `openProject({ cwd, env })` | The repository's `Project`: its `repo`, `directory`, `sql`, `store`, `snapshots`, and `close()` |
| `review(project, options)` | Returns a `ReviewResult`: the `comparison`, `reusedFromRun`, `dirtyPaths`, `baseline`, `stabilityChecked`, `differences`, `playErrors`, `unstable`, `warnings`, and `timings` |
| `decide(project, { runId, decision, actor, stories })` | `stories` is `"all"`, patterns, or `{ targets }`: exact stories and image hashes, for a caller that showed them, refused whole with `stale-decision` if any isn't a changed or new image the run holds. Returns `decided`, `skipped`, `unmatchedPatterns`, and the `comparison` after it. It compares twice, and reads unchanged rows only for patterns |
| `accept(project, { runId, removedSeen })` | Returns `accepted`, `refusals`, `usableAsBaseline`, `reusedFromRun`, and the `comparison` |
| `checkAccept(project, comparison, removedSeen)` | What `accept` would refuse of a comparison a caller holds, changing nothing: `refusals`, `usableAsBaseline`, and `removals` |
| `summarizeRun(comparison)` | Returns `blockers`, `advisories`, `counts`, `undecided`, `unapproved`, `failed`, `removed`, and `notRendered` |
| `isDecidable(state)` | Whether a snapshot in this state can take a decision: `changed` or `new`. Defined in `selfie-store` |
| `compareAsReviewed(project, runId, options)` | A run compared with the baseline its reviewer saw |
| `findBaseline(project, environment)`, `resolveCaptureSettings(repo, { native })`, `gitUserEmail(repo)` | What the commands use for these |
| `readReviewCache(project, runId)` | The paths and pixel diffs a review exported, or null once pruned |
| `SelfieError` | Has a `code`, so a caller can tell cases apart without reading its message |

- **Must keep facts in results and compute verdicts.** A result never says what needs attention: `summarizeRun` does, from a comparison, so a verdict can be recomputed after any decision.
- **Must keep command wording out of results.** `next` steps and refusal messages are built in `cli/src/document.ts`, and a refusal holds fields such as `stories` and `outsideFilter`.
- **Must keep printing and exit codes in `cli/src/cli.ts`.**
- **Must take the types the review UI also reads from `selfie-ui/app`, with `import type`**, so each has one definition and nothing is loaded for them: `PixelDiff`, `AcceptRefusal`, `Attention`, and the reasons.

## Local data

Source of truth: `cli/src/paths.ts`, `cli/src/project.ts`; tests in `cli/test/units.test.ts`.

`<home>` is `$SELFIE_HOME` if set, and otherwise `~/.config/selfie`.

```
<home>/<slug>/
  store.db                               SQLite, per docs/specs/store.md, with two tables of its own (Recording only if necessary)
  blobs/images/<image hash>              Filesystem blobs, per docs/specs/store.md
  runs/<run id>/review.json              A disposable cache of exported paths and pixel diffs
  runs/<run id>/stories/<name>/*.png     current, golden, diff, and repeat
  capture/<uuid>/                        One capture's output, deleted when the review ends
```

- **Never read `<home>/d1.env`**, or anything else in `<home>` that isn't under a project's slug.
- **Must make a slug of only `[a-z0-9-]`**, so it holds no separator or dot, can't climb out of `<home>`, and can't be a file there such as `d1.env`. It is the readable origin, cut to 80 characters, then 8 hex digits of the normalized origin's SHA256, so `a/b-c` and `a-b/c` stay apart.
- **Must normalize an origin to its lowercased host and path, with no scheme, credentials, port, trailing slash, or `.git`**, so an SSH and an HTTPS clone share a store, and a token in a URL reaches no path, document, or log. The origin goes no further than the slug.
- **Must use `local-<16 hex digits>` of the Git common directory for a repository with no origin**, so its worktrees share a store.
- **Must create a project's directory private to its user**, since it holds screenshots of what may be a private repository.

## Review

Source of truth: `cli/src/review.ts`, `cli/src/diff.ts`, `cli/src/png.ts`; tests in `cli/test/commands.test.ts` with a stand-in for `capture`, and `cli/test/review.container.test.ts` with the real one.

In order, a review:

1. Runs `--build-command`, if given, in a shell. Its stdout goes to stderr. **Never guess a project's build system.** **Never use a shell for anything else.**
2. Reads HEAD and the working tree, and finds the baseline ([`find-baseline`](#find-baseline)).
3. Unless that exact build [already rendered](#recording-only-if-necessary), captures `--storybook-dir` (default `storybook-static`) in a new capture directory, with `--story` patterns, the project's [init script](#configuration), and, if asked, `--stability`.
4. Checks HEAD didn't move.
5. Begins a run recording whether the tree was dirty, the baseline, and any filter. Stores each PNG as written with `Store.putImages`, or takes an earlier render's rows, and records and finishes the run with `Snapshots`. Rows carry the failure message, the `play` error, and the unstable flag.
6. Compares the run with the baseline.
7. Exports images and pixel diffs for what isn't unchanged, writes `review.json`, and prunes [output](#output-directories).

- **Must do diff work only on a `changed` snapshot.** A `new` or `removed` one exports its one image, and an unchanged one nothing, unless it has an advisory.
- **Must report a different size as `pixelDiff.kind: "size-differs"`, with no diff image**, not as a failure.
- **Must make the diff image from the current image, faded to light gray, with changed pixels solid `#ff0050`.** Its encoder lives in `cli/`, since `docs/specs/store.md` → Storage forbids one in the store.
- **Must treat a capture's unusable file as that story's failure**: a manifest path outside the capture directory, a path that isn't a regular file, or a PNG the store refuses. Other stories continue.
- **Must fail with exit 2 if HEAD moves during the render, or if no story was captured**, since one Git SHA must describe the run, and a typo must not pass.
- **Must record a run as dirty if the tree had changes either before or after the render.** Ignored files don't count, so a gitignored `storybook-static` doesn't dirty the tree, and neither does a stale one (rationale).
- **Must leave stability off unless asked, and say which in `stabilityChecked`** (rationale).
- **Must not call a golden removed when `--story` left its story out.** Such goldens are counted in `filter.notRendered`, and are not in `differences`, `counts.removed`, or `blockers`. A removed story matching a pattern still is.

### What blocks

Source of truth: `summarizeRun` in `cli/src/summary.ts`.

- **Must exit 1 if `blockers` isn't empty, and never because of `advisories`.** Each entry has a `story`, a `reason`, and a `detail` holding the fact behind it, if there is one:

| List | `reason` | When | `detail` |
|---|---|---|---|
| `blockers` | `failed` | The story failed to render, or its image was unusable | The failure |
| | `changed-unapproved`, `new-unapproved` | Its image has no decision | |
| | `rejected` | Its image is rejected | The actor |
| | `removed` | The baseline has its golden, and this run doesn't have the story | |
| | `pattern-unmatched` | A `--story` pattern matched nothing, while another did. `story` is null | The pattern |
| `advisories` | `play-error` | Its `play` function threw. Its image is still recorded (`docs/specs/render.md` → Manifest) | The message |
| | `unstable` | `--stability` saw it render differently twice | |

- **Must not list an approved image**: it is still in `differences`, with its `decision`. That is how an approval made earlier, at any Git SHA, needs no repeating (`docs/specs/system.md` → Approvals).
- **Must list an advisory whatever its story's state**, including unchanged, and count them in `counts.advisories`.
- **Never make an advisory a gate.** `accept` reports them, but `acceptRun`'s checks are the only ones on an image (`docs/specs/snapshots.md` → Open questions).

### Recording only if necessary

Source of truth: `cli/src/reuse.ts`, `hashTree` and `rendererIdentity` in `render/src/identity.ts`; tests in `cli/test/reuse.test.ts`, `render/test/identity.test.ts`.

A review recognizes a build that already rendered, skips capture and storing, and records that render's image hashes, `play` errors, and unstable flags in a new run. Everything else about a review stays: the run has this review's Git SHA, dirtiness, baseline, and filter, and it compares, exports, exits, and can be decided on and accepted like any other. Docker isn't needed for this, since nothing starts.

- **Must key a render on all of these, so that any one changing renders again:**

| Input | From |
|---|---|
| The build | A SHA256 of `--storybook-dir` after any `--build-command`: every file's relative path and bytes, sorted by path. **Never use a file's size or time** |
| The environment | Its ID |
| The settle time | `DEFAULT_SETTLE_MS` |
| The init script | Its SHA256 |
| The renderer | `rendererIdentity()`, a hash of `render/src`, so a change to capture code renders again in a checkout, where the package's version never changes |
| Stability | Whether `--stability` was asked for |
| The filter | The sorted, distinct `--story` patterns, or none |

- **Must leave out of the build's hash exactly this text, of exactly these files, and nothing by a pattern over paths**, since it differs between builds of one source, and nothing in a build loads these files (rationale):

| File, from the build's root | Text |
|---|---|
| `project.json` | A leading `{"generatedAt":<digits>,` |
| `manifests/components.html` | The first `Generation took <strong><number>s</strong>` |

- **Never reuse a build holding anything but files and directories**, since what a symlink reaches isn't in its hash.
- **Never reuse in a native environment.** `--native` always renders, since its ID doesn't describe everything about its machine.
- **Never reuse a run with a failed story**, including an image the store refused, however many times it fails (rationale).
- **Never reuse a run where any story has an error other than `play`, `console`, or `page`, or where capture warned of anything but an unmatched pattern** (rationale). Those three are the project's own code, and reuse keeps its `play` errors as advisories. Everything else, such as `request` and the soft `timeout`, might not happen next time.
- **Must keep only the newest real render of a key, and forget the key if that render can't be reused**, so a forced render that fails isn't hidden by an older one that passed.
- **Must not remember a render if the build's hash changed while it rendered**, since no key describes those images.
- **Must always name a run that really rendered:** a reused run is never itself remembered, so reuse doesn't chain.
- **Must keep stability separate:** a run with it answers only a review with it, and a run without it only a review without it, so `stabilityChecked` always says what this review asked (rationale). A reused run's `unstable[].repeat` is that render's second image if its run directory is still there, and null once pruned, since the store doesn't keep them.
- **Must answer a filtered review from the build's whole run, by the filter**, or else from a run with the same patterns in any order. **Never answer a wider request from a filtered run.** `filter`, `warnings`, and `blockers` come out as a render's would, and a filter matching nothing still exits 2.
- **Must render with `--no-reuse` or `"reuse": false` in the [config](#configuration).** Such a render still updates what's remembered, so `--no-reuse` is also how to replace a render.
- **Must make it visible:** `reusedFromRun` in the document, one line on stderr, and `reusedFromRun` in what `accept` returns and prints, with one line on stderr, since that run's pixels came from an earlier render. A render that can't be reused says why on stderr.
- **Must keep this in two tables in the local `store.db`, created by `openProject`, and out of the store's schema**, so D1 has no counterpart and a pruned `review.json` loses nothing: `render_keys(key, run_id)` and `reused_runs(run_id, from_run_id)`.

### The document

Every path is absolute, and names a file that exists until it is pruned.

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `runId`, `gitSha` | The run, and what it was recorded against |
| `reusedFromRun` | The run that really rendered these images, or null if this one did ([Recording only if necessary](#recording-only-if-necessary)) |
| `dirtyPaths` | Up to 20 of the tree's changes while it rendered. Empty means clean |
| `baseline` | `sha`, `reason`, and `message`, as [`find-baseline`](#find-baseline) gives them |
| `environment` | Its ID |
| `filter` | `patterns` and `notRendered`, or null with no `--story` |
| `stabilityChecked` | Whether `--stability` ran |
| `counts` | `stories`, `unchanged`, `changed`, `new`, `removed`, `undecided`, and `advisories` |
| `blockers[]`, `advisories[]` | `story`, `reason`, `detail` |
| `differences[]` | `story`, `state`, `decision`, `imageHash`, `goldenHash`, `current`, `golden`, `diff`, `pixelDiff` |
| `playErrors[]` | `story`, `playError`, `current` |
| `unstable[]` | `story`, `current`, `repeat` |
| `warnings[]` | The manifest's |
| `next[]` | What to do next, in words and commands |

`pixelDiff` is `{ kind: "pixels", changedPixels, totalPixels, boundingBox, firstChanged, maxChannelDelta }`, where `firstChanged` is the first changed pixel in reading order, or `{ kind: "size-differs", current, golden }` with their widths and heights, and is null unless `changed`.

- **Must keep a difference's hashes**, so a UI can cache images by content.
- **Must say, when the baseline is null and HEAD isn't the merge-base, that the next step is to review and accept at the merge-base on the default branch**, since goldens accepted on a feature branch aren't read by later reviews.

## Output directories

Source of truth: `cli/src/project.ts`.

- **Must keep every fact about a run in the store**, so that deleting a run directory loses nothing but the exported files: a pruned run can be decided on and accepted, and its images come from `Store.getImage`.
- **Must give each review its own capture directory and run directory, named by UUID**, so concurrent reviews can't touch each other's files.
- **Must delete a capture directory when its review ends, however it ends.** A later review deletes one over 24 hours old, left by a crash.
- **Must keep the newest 20 run directories, and delete older ones at the end of each review** (rationale). A run is never deleted from the store, per `docs/specs/snapshots.md` → Open questions, and an image's blob stays with it.
- **Must write `review.json` atomically.** It holds exported paths and pixel diffs, which are all it can lose.

## Approve and reject

Source of truth: `decide` in `cli/src/decisions.ts`.

- **Must decide on exactly the run's `changed` and `new` images selected by `--all` or `--story`, and require exactly one of those.** Unchanged images get no decision. Failed and removed ones have no image, and are listed under `skipped`.
- **Must work on a dirty tree**, so a user can approve work before committing it (`docs/specs/system.md` → Approvals).
- **Must take the actor from `--actor`, or else `git config user.email`**, and fail if there's neither.
- **Must compare against the baseline recorded on the run**, the one its reviewer saw.

It prints `runId`, `decision`, `actor`, `decided`, `skipped`, `undecided` (what still has no decision), and `unmatchedPatterns`.

A first run needs every image approved: `selfie approve <run> --all`, then `selfie accept <run>`.

## Accept

Source of truth: `accept` in `cli/src/decisions.ts`.

- **Must refuse, with exit 1, and report every reason at once:**

| `reason` | When | Fields |
|---|---|---|
| `recorded-on-dirty-tree` | The run was recorded on a dirty tree, even if it is clean now (rationale). `acceptRun` refuses this for every caller | `gitSha` |
| `run-has-failures` | A story failed to render | `stories` |
| `unapproved` | A changed or new image isn't approved | `stories` of `story`, `state`, `decision` |
| `removed-unacknowledged` | The baseline has stories this run lacks, and `--removed` wasn't passed | `stories`, `outsideFilter` |
| `wrong-removed-count` | `--removed` isn't the count there is | `stories`, `outsideFilter`, `seen` |

- **Must not check the tree as it is now**: only how the run was recorded decides whether its images describe its SHA (rationale). So a run recorded clean may be accepted while HEAD is elsewhere or the tree has moved on.
- **Must pass `acceptRun` the count the caller gave in `--removed`, and 0 if there are no removals.** `docs/specs/snapshots.md` → Goldens owns what it does with it. A filtered run may be accepted, once acknowledged, and then drops the goldens it left out.
- **Must report `usableAsBaseline`: whether the SHA is on the default branch's first-parent history, or HEAD's if there is none.** Accepting off it succeeds, and later reviews won't read those goldens ([`find-baseline`](#find-baseline)).
- **Must report the run's advisories in its output, accepted or not.**

It prints `accepted`, `runId`, `reusedFromRun`, `gitSha`, `environment`, `baselineSha`, `usableAsBaseline`, `removed`, `refusals[]` with each one's fields and a `message`, and `advisories`.

## find-baseline

Source of truth: `cli/src/git.ts`; tests in `cli/test/git.test.ts`, on real Git repositories.

- **Must run Git only by argument arrays, never through a shell.**
- **Must choose the default branch as the first of these that exists:** `origin/HEAD`'s target, `origin/main`, `origin/master`, local `main`, local `master`. With none, it walks from HEAD and says so in `message`.
- **Must start at the merge-base of HEAD and the default branch, and walk first-parent history, nearest first, for at most 1,000 commits, to the first SHA with complete goldens in the environment.** A branch's own goldens are never its baseline (rationale). It asks through `Snapshots.firstWithGoldens`, about 10 queries for 1,000 commits at worst.
- **Must exit 0 whatever it finds, and explain null** with `reason` and `message`:

| `reason` | When |
|---|---|
| `no-commits` | The repository has none |
| `no-merge-base` | HEAD shares no history with the default branch |
| `shallow-history` | The clone is shallow, and history ended before an answer |
| `limit-reached` | 1,000 commits had no goldens |
| `no-goldens` | The whole history was checked |

It prints `sha`, `reason`, `message`, `defaultBranch`, `mergeBase`, and `environment`.

- **Must use local data only.** `sync` adds the cloud's goldens ([Future](#future)).

## ui

Source of truth: `cli/src/ui.ts`, and `selfie ui` in `cli/src/cli.ts`; tests in `cli/test/ui.test.ts`. `docs/specs/ui.md` owns what it serves.

- **Must print `{ url, port, runId }` once it is listening, then keep serving until a signal**, and exit 0. `runId` is the run it was asked to open, or null.
- **Must take an optional run**, and refuse a bad or unknown one with exit 2 before listening. With none, the page opens at the newest finished run at HEAD in this project's environment, or `--native`'s.
- **Must ask the system for a free port unless given `--port`**, so two projects can both be served.
- **Never open a browser.** Whoever ran it decides what to do with the URL.
- **Must load `selfie-ui` and Hono only in this command**, by a dynamic `import()`, so no other command pays for a web server. `cli/test/ui.test.ts` checks what `cli/src/cli.ts` loads.
- **Must fail with `ui-not-built` and exit 2 if the client isn't built**, saying what to run: `pnpm --filter selfie-ui build`. `pnpm install` builds it, through `prepare`.
- **Must take a decision's actor from `git config user.email`, or refuse with `no-actor`.** There's no `--actor` here, since a page has no way to be anyone else.

## Configuration

Source of truth: `cli/src/config.ts`.

`selfie.config.json` at the Git top level is the only place a project configures Selfie:

| Key | Meaning |
|---|---|
| `environment` | Overrides for `defineEnvironment` (`docs/specs/render.md` → Environment) |
| `initScript` | A file inside the Git top level, used as `capture`'s `initScript` |
| `reuse` | `false` always renders ([Recording only if necessary](#recording-only-if-necessary)). Defaults to `true` |

- **May let `--native` win over its `runner`.**
- **Must refuse an unknown key**, so a typo can't silently render the wrong environment.
- **Never read a build command from a file.** A checkout must not be able to run a shell; only `--build-command` can.

## Untrusted input

Source of truth: `cli/src/paths.ts`.

Story IDs come from a project's build, and a manifest's paths from a directory its worker can write.

- **Must make a story's directory name only `[A-Za-z0-9_-]`, cut to 80 characters, followed by 10 hex digits of the ID's SHA256**, so it can't climb out, and IDs differing only by case or punctuation stay apart on any filesystem.
- **Must read a capture's file only if it lies under the capture directory and is a regular file, not a symlink.**
- **Must refuse a run ID that isn't a lowercase UUID before it reaches a path.**

## Future

**Scope: sync** is defined in `docs/specs/system.md` → Build order. For this CLI it still needs:

- `find-baseline` asking the cloud's goldens as well as local ones.
- `selfie push` and `selfie pull`, and carrying decisions through them (`docs/specs/snapshots.md` → Future).
- A way for a branch's reviewer to have a baseline when only other machines accepted the default branch's goldens.

### A render that does change

[Recording only if necessary](#recording-only-if-necessary) is all or nothing, so one changed file renders every story, and a render's non-capture time is unchanged:

- A cache from PNG bytes to image hash, since decoding and hashing unchanged images is most of a review's non-render time.
- A diff cache by hash pair.
- Reusing only the stories a change can reach.

### Open questions

- **A stale gitignored build.** Nothing ties a built Storybook to the commit it came from, so a clean tree with an old `storybook-static` records the old pixels against the new SHA. `--build-command` avoids it, and only a hash recorded at build time would catch it.
- **Two Storybooks in one repository.** They share a slug and an environment, so their story IDs share names, and neither can be accepted without the other reading as removed.
