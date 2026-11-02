# CLI

> Status: built — `selfie review`, `approve`, `reject`, `accept`, and `find-baseline`, on the local store. Nothing here reaches the cloud; see `## Future`.
>
> - See `docs/specs/glossary.md` for run, snapshot, golden, baseline, decision, and environment.
> - Owns local data's layout, each command's checks and exit code, and the shape of what they print. `docs/specs/snapshots.md` owns what a run, a decision, and a golden are. `docs/specs/render.md` owns capture. `docs/specs/store.md` owns images.

## Commands

Source of truth: `cli/src/cli.ts`; the real binary's tests are in `cli/test/binary.test.ts`. `selfie --help` lists every flag.

| Command | Does |
|---|---|
| `selfie review` | Renders a built Storybook, records a run, and prints the diff against the baseline |
| `selfie approve <run>`, `selfie reject <run>` | Records a decision on a run's changed and new images, with `--all` or `--story <pattern>` |
| `selfie accept <run>` | Makes a run the goldens of its Git SHA |
| `selfie find-baseline` | Prints the baseline this repository and environment would use |

- **Must print exactly one document on stdout, whatever happens,** and everything for people on stderr. A command that couldn't run prints `{ "error": { "name", "message" } }`. `selfie review --human` prints a short summary in place of its JSON. `--help` prints usage.
- **Must use these exit codes:**

| Code | Meaning | Examples |
|---|---|---|
| 0 | Nothing needs attention | A review with nothing to decide, a decision recorded, a run accepted, any `find-baseline` result |
| 1 | The command ran, and something needs attention | A review listing anything in `needsAttention`, `accept` refusing, a `--story` pattern on `approve` or `reject` that matched nothing |
| 2 | The command couldn't run | Not a Git repository, no commits, no Storybook, no Docker, a failed `--build-command`, a bad flag, an unknown run, a run with no record, `--story` matching no story at all |

- **Must take a story pattern as `docs/specs/render.md` → Capture defines it:** an ID, where `*` matches any run of characters.

## Local data

Source of truth: `cli/src/paths.ts`, `cli/src/project.ts`; tests in `cli/test/units.test.ts`.

`<home>` is `$SELFIE_HOME` if set, and otherwise `~/.config/selfie`.

```
<home>/<slug>/
  store.db                               SQLite, per docs/specs/store.md
  blobs/images/<image hash>              Filesystem blobs, per docs/specs/store.md
  runs/<run id>/review.json              The review's document, which later commands read
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
3. Captures `--storybook-dir` (default `storybook-static`) in a new capture directory, with `--story` patterns, `--init-script`, and, if asked, `--stability`.
4. Stores each PNG as written with `Store.putImages`, and records and finishes the run with `Snapshots`. Rows carry the failure message and the unstable flag.
5. Compares the run with the baseline, and exports images and pixel diffs for what isn't unchanged.
6. Writes `review.json`, prunes [output](#output-directories), and prints the document.

- **Must do diff work only on a `changed` snapshot.** A `new` or `removed` one exports its one image, and an unchanged one nothing, unless it needs attention.
- **Must report a different size as `pixelDiff.kind: "size-differs"`, with no diff image**, not as a failure.
- **Must make the diff image from the current image, faded to light gray, with changed pixels solid `#ff0050`.** Its encoder lives in `cli/`, since `docs/specs/store.md` → Storage forbids one in the store.
- **Must treat a capture's unusable file as that story's failure**: a manifest path outside the capture directory, a path that isn't a regular file, or a PNG the store refuses. Other stories continue.
- **Must fail with exit 2 if HEAD moves during the render, or if no story was captured**, since one Git SHA must describe the run, and a typo must not pass.
- **Must record `dirty` as whether the tree had changes either before or after the render.** Ignored files don't count, so a gitignored `storybook-static` doesn't dirty the tree, and neither does a stale one (rationale).
- **Must say so in `stability.note` when `--stability` wasn't passed**, and leave `counts.unstable` null rather than 0. It is off by default (rationale).
- **Must not call a golden removed when `--story` left its story out.** Such goldens are counted in `filter.notRendered`, and are not in `differences`, `counts.removed`, or `needsAttention`. A removed story matching a pattern still is.

### What needs attention

- **Must list these in `needsAttention`, and exit 1 if it isn't empty,** each with its story, `reason`, and a `detail`:

| `reason` | When |
|---|---|
| `failed` | The story failed to render, or its image was unusable |
| `play-error` | Its `play` function threw. Its image is still recorded (`docs/specs/render.md` → Manifest) |
| `unstable` | `--stability` saw it render differently twice |
| `changed-unapproved`, `new-unapproved` | Its image has no decision |
| `rejected` | Its image is rejected |
| `removed` | The baseline has its golden, and this run doesn't have the story |
| `pattern-unmatched` | A `--story` pattern matched nothing, while another did. `story` is null |

- **Must not list an approved image**: it is still in `differences`, with its `decision`. That is how an approval made earlier, at any Git SHA, needs no repeating (`docs/specs/system.md` → Approvals).
- **Must list a `play` error or an unstable story whatever its state**, including unchanged ones.
- **Never make `play` errors or instability a gate.** They need attention, and `accept` reports them, but `acceptRun`'s checks are the only ones on an image (`docs/specs/snapshots.md` → Open questions).

### The document

Every path is absolute, and names a file that exists.

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `runId`, `status` | The run, and `complete` or `failed` |
| `gitSha`, `dirty`, `dirtyPaths` | What it was recorded against. `dirtyPaths` holds at most 20 |
| `baselineSha`, `baseline` | The baseline or null, and the whole `find-baseline` result |
| `environment` | `id` and `definition` |
| `initScriptSha256`, `storybookDir`, `outputDir` | What it rendered, and its run directory |
| `filter` | `patterns` and `notRendered`, or null with no `--story` |
| `stability` | `checked` and `note` |
| `counts` | `stories`, `unchanged`, `changed`, `new`, `removed`, `failed`, `playErrors`, `unstable`, `approved`, `rejected`, `undecided`, `needsAttention` |
| `needsAttention[]` | `story`, `reason`, `detail` |
| `differences[]` | `story`, `state`, `decision`, `unstable`, `imageHash`, `goldenHash`, `current`, `golden`, `diff`, `pixelDiff` |
| `failures[]` | `story`, `failure`, `goldenHash` |
| `playErrors[]` | `story`, `errors`, `current` |
| `unstable[]` | `story`, `current`, `repeat` |
| `warnings[]` | The manifest's |
| `next[]` | What to do next, in words and commands |
| `timings` | `captureMs`, `storeMs`, `compareMs`, `diffMs`, `totalMs` |

`pixelDiff` is `{ kind: "pixels", changedPixels, totalPixels, boundingBox, maxChannelDelta }`, or `{ kind: "size-differs", current, golden }` with their widths and heights, and is null unless `changed`.

## Output directories

Source of truth: `cli/src/project.ts`.

- **Must give each review its own capture directory and run directory, named by UUID**, so concurrent reviews can't touch each other's files.
- **Must delete a capture directory when its review ends, however it ends.** A later review deletes one over 24 hours old, left by a crash.
- **Must keep the newest 20 run directories, and delete older ones at the end of each review** (rationale). A run is never deleted from the store, per `docs/specs/snapshots.md` → Open questions, and an image's blob stays with it.
- **Must refuse to decide on or accept a run with no `review.json`**, with exit 2 and the advice to review again. That includes a run a crash left `recording`. Approvals are in the store, so nothing is lost.
- **Must write `review.json` last, atomically**, so a run with a record has everything the record names.

## Approve and reject

Source of truth: `cli/src/decisions.ts`.

- **Must decide on exactly the run's `changed` and `new` images selected by `--all` or `--story`, and require exactly one of those.** Unchanged images get no decision. Failed and removed ones have no image, and are listed under `skipped`.
- **Must work on a dirty tree**, so a user can approve work before committing it (`docs/specs/system.md` → Approvals).
- **Must take the actor from `--actor`, or else `git config user.email`**, and fail if there's neither.
- **Must compare against the baseline in the run's `review.json`**, the one its reviewer saw.

It prints `runId`, `decision`, `actor`, `decided`, `skipped`, `undecided` (what still has no decision), and `unmatchedPatterns`.

A first run needs every image approved: `selfie approve <run> --all`, then `selfie accept <run>`.

## Accept

Source of truth: `cli/src/decisions.ts`.

- **Must refuse, with exit 1, and report every reason at once:**

| `reason` | When |
|---|---|
| `dirty-tree` | The tree is dirty now |
| `recorded-on-dirty-tree` | The run was recorded on a dirty tree, even if it is clean now (rationale) |
| `run-has-failures` | A story failed to render |
| `unapproved` | A changed or new image isn't approved. `unapproved[]` lists them |
| `removed-unacknowledged` | The baseline has stories this run lacks, and `--removed` wasn't passed |
| `wrong-removed-count` | `--removed` isn't the count there is |

- **Must show what a refusal is about by name**, in its `message` and in `removed[]`, including which removals are only outside a `--story` filter.
- **Must pass `acceptRun` the count the caller gave in `--removed`, and 0 if there are no removals.** `docs/specs/snapshots.md` → Goldens owns what it does with it. A filtered run may be accepted, once acknowledged, and then drops the goldens it left out.
- **May accept a run recorded clean at an earlier commit, while HEAD is elsewhere**, since its goldens describe that commit.
- **Must report the run's `playErrors` and `unstable` in its output, accepted or not.**

It prints `accepted`, `runId`, `gitSha`, `environment`, `baselineSha`, `removed`, `playErrors`, `unstable`, and when refused, `refusals[]` of `reason` and `message`, and `unapproved`.

## find-baseline

Source of truth: `cli/src/git.ts`; tests in `cli/test/git.test.ts`, on real Git repositories.

- **Must run Git only by argument arrays, never through a shell.**
- **Must choose the default branch as the first of these that exists:** `origin/HEAD`'s target, `origin/main`, `origin/master`, local `main`, local `master`. With none, it walks from HEAD and says so in `message`.
- **Must start at the merge-base of HEAD and the default branch, and walk first-parent history, nearest first, to the first SHA where `hasCompleteGoldens` is true in the environment.** A branch's own goldens are never its baseline (rationale).
- **Must stop after `--max-commits` commits, default 1,000.**
- **Must exit 0 whatever it finds, and explain null** with `reason` and `message`:

| `reason` | When |
|---|---|
| `no-commits` | The repository has none |
| `no-merge-base` | HEAD shares no history with the default branch |
| `shallow-history` | The clone is shallow, and history ended before an answer |
| `limit-reached` | `--max-commits` ran out |
| `no-goldens` | The whole history was checked |

It prints `baselineSha`, `environment`, `head`, `detached`, `defaultBranch`, `mergeBase`, `commitsChecked`, `maxCommits`, `shallow`, `reason`, and `message`.

- **Must use local data only.** `sync` adds the cloud's goldens ([Future](#future)).

## Configuration

Source of truth: `cli/src/config.ts`.

`selfie.config.json` at the Git top level, or the file `--config` names, holds:

| Key | Meaning |
|---|---|
| `environment` | Overrides for `defineEnvironment` (`docs/specs/render.md` → Environment) |
| `initScript` | A file inside the config's directory, used as `capture`'s `initScript` |

- **Must let a flag win over the config**, and the config over the default: `--native` over `runner`, `--init-script` over `initScript`.
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

- `find-baseline` asking the cloud's goldens as well as local ones, and its per-commit question batched, since each is a request there.
- `selfie push` and `selfie pull`, and carrying decisions through them (`docs/specs/snapshots.md` → Future).
- A way for a branch's reviewer to have a baseline when only other machines accepted the default branch's goldens.

**Scope: local-review** is defined in `docs/specs/system.md` → Build order, and reads the same store and run directories.

### Recording only if necessary

The README's `review` records "only if necessary", and today it always renders. Reusing a finished run needs a way to prove the build hasn't changed, such as a hash of the Storybook directory, and an identical init script and environment.

### Open questions

- **A stale gitignored build.** Nothing ties a built Storybook to the commit it came from, so a clean tree with an old `storybook-static` records the old pixels against the new SHA. `--build-command` avoids it, and only a hash recorded at build time would catch it.
- **Two Storybooks in one repository.** They share a slug and an environment, so their story IDs share names, and neither can be accepted without the other reading as removed.
