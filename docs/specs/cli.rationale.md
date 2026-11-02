# CLI — Rationale

> Informative companion to [cli.md](cli.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Commands

**Blockers and advisories.** Dormouse has two stories with real `play` errors, so with every attention item counted, every review of it exited 1 forever, and 1 stopped meaning anything: an agent learns to ignore it, or can't tell the two errors it knew about from a new one. So `play` errors and instability became advisories, which leave the exit code alone. The cost is the one the spec names, that a new `play` failure doesn't change the exit code. A blocker must be something accepting would refuse or a reviewer must decide, and those two kinds of finding aren't that. The user hasn't reviewed this.

**Exit 2 and a typo.** A pattern that matches nothing at all is 2, while one typo beside a good pattern is 1: the second run did render something, and would otherwise read as a pass.

**Everything is one document, including failures.** An agent that parses stdout shouldn't need a second path for the failure case. A build command's stdout could break that, so it goes to stderr. Timings are for people, so they went to stderr too.

## Library

**Facts and verdicts apart.** The local review UI is the next caller. It approves images one at a time, and must show what's left after each without re-rendering, so whatever computes a verdict must take only what `compareRun` returns. `summarizeRun` does, and the CLI's `blockers`, `advisories`, `undecided`, and a refusal's lists all come from it, so they can't disagree.

**Coded errors.** A UI wanting to tell "no such run" from "not a repository" would otherwise be reading message text.

## Local data

**A hash after the readable slug.** Slugifying is lossy: `a/b-c` and `a-b/c` read the same. Eight hex digits keep them apart, and since a slug always ends with them and never holds a dot, nothing can equal `d1.env`.

**One store across SSH and HTTPS.** Someone cloning a repository twice, once each way, is the same project with the same goldens. Dropping the port costs nothing real: two different repositories at one host and path, on two ports, is not worth a separate case.

## Review

**A dirty run is recorded, not refused.** Rendering uncommitted work is the point of the loop. It can be compared and approved, and [`accept`](#accept) is where it stops.

**Stability is off by default.** It renders everything twice, which on 541 stories costs 197 s against 70 s, and agents run this constantly.

**A gitignored build isn't dirty.** It usually is ignored, so counting it would make every review dirty. The cost is the [open question](cli.md#open-questions) about stale builds.

### What blocks

**An approved change doesn't.** This is what makes "commit, review again, no re-approval" exit 0, and it's the behavior `docs/specs/system.md` → Approvals asks for. The change stays in `differences`, with who approved it, so nothing is hidden.

**A removal does, though no decision exists for it.** It takes `--removed` to accept, so a review that exits 0 mustn't be followed by an `accept` that refuses.

## Output directories

**Pruning loses no facts.** Run directories were first where a run's dirty flag and baseline lived, so pruning one stopped it being acted on, and made the rule against accepting dirty runs depend on a file. Those moved to the store (`docs/specs/snapshots.rationale.md` → Runs), and `review.json` can be deleted at any time.

**Per-run directories rather than one reused one.** A reused directory would be smaller to describe, but a concurrent review, or an agent still reading the last review's images, would see files change underneath it. A run ID in the path also means a run's JSON keeps pointing at its own images.

**Twenty.** It is meant to outlast an agent's review, fix, review cycle within one task, and be small. Run directories only hold what differs: the 541-story review with nothing changed left 48 KB, holding the images of the 2 stories with `play` errors, and one with 130 changed stories left 14 MB, or about 110 KB per changed story. Twenty runs each changing all 541 would hold about 1.2 GB. A capture directory holds every story's PNG, so it can't outlive its review.

**The store still grows.** Blobs grow only with new images, but nothing deletes either them or a run's rows: `docs/specs/snapshots.md` → Open questions owns retention. After the 12 runs below and in the sample loop, holding 2,914 run rows and 650 images, `store.db` was 512 KB and `blobs/` 25 MB.

## Accept

**Only how the run was recorded.** The images come from the moment it rendered, so review with an edit in place, `git checkout .`, and the tree is clean while the run's images aren't that commit's. The same goes for reviewing dirty and committing, where the run's SHA is the commit before the edit. Either way a golden would misdescribe its SHA. A check of the tree as it is now adds nothing to that: a run recorded clean describes its SHA whatever has happened to the tree since. Refusing a dirty run costs one more render after committing, and no approvals, since those carry over. `cli/test/commands.test.ts` covers both.

**Reporting every refusal at once.** An agent otherwise fixes one, runs again, and finds the next.

**No extra gate for a filtered run.** `acceptRun`'s count already catches it, and the refusal says how many removals are only outside the filter. A person who wants a partial golden set can have one, and the rest read as new later, with their approvals intact.

**`usableAsBaseline`.** Accepting on a feature branch succeeds, and no later review reads the result, since a baseline comes from the default branch's history. That's correct by the README's definition, and surprising, so it's reported rather than refused. Off-branch goldens may still be wanted by a later sync.

## find-baseline

**A branch's own goldens aren't its baseline.** The README defines the baseline as a merge-base, so that a pull request's changes are reported against what it will merge into, cumulatively, however many commits it has. A branch accepting at its own commits doesn't move that. The cost is that a branch sees no baseline until someone accepts on the default branch, which is local to one machine until `sync`.

**First-parent history.** On a default branch, that is the commits it actually was, rather than whatever a merged branch passed through, whose goldens might describe unreviewed work.

**A limit of 1,000, asked in groups.** The bound is for a repository where nothing has goldens, and for `sync`, when these become cloud requests. An `IN` query of 99 SHAs makes that about 10 queries instead of 1,000, and one in the usual case, where a nearby commit has goldens.

**Local candidates.** `main` and `master` are checked after `origin/*`, since an agent's scratch repository has no origin, and a clone's `origin/HEAD` is what names a different default.

## Configuration

**One file, in one place.** Every command that needs an environment must find the same one, or `find-baseline` and `review` disagree. `--config` and `--init-script` let them, so they went. A file at the Git top level does the job without a flag on each call. `--native` stays, for a machine trying something locally, since a checked-in file shouldn't choose that.

**A config can't name a file outside itself.** A checkout's config file isn't the user's choice in the way a flag is. An init script is only ever run in the browser, with no network, so this is a small precaution at the cost of one check.

## End to end

**Measured 2026-11**, on a copy of dormouse's built Storybook (541 stories) in a scratch Git repository, on a Mac, in the pinned arm64 container, with `window.__ARGOS_SNAPSHOT__ = true` as the init script in `selfie.config.json`, and 6 stories at once.

| 541-story review | Exit | Wall | Capture | Store | Compare | Diff |
|---|---|---|---|---|---|---|
| First, 512 new images, 29 unchanged | 1 | 72.3 s | 63.1 s | 8.9 s | 2 ms | 56 ms |
| Nothing changed, twice | 0 | 68.6 s, 70.1 s | 64.2 s, 65.7 s | 4.2 s, 4.1 s | 1 ms, 1 ms | 3 ms, 3 ms |
| 130 changed by a CSS color | 1 | 73.9 s | 66.6 s | 5.3 s | 1 ms | 1,656 ms |
| Nothing changed, `--stability` | 0 | 196.7 s | 192.2 s | 4.1 s | 1 ms | 3 ms |

The two exit 0 rows list dormouse's 2 `play` errors as advisories, and no story was unstable with the freeze on. Capture is most of the time, as `docs/specs/render.rationale.md` found. Storing costs about 7.6 ms per image to decode and hash when it's already stored, and about 17 ms when it's new. A diff costs about 13 ms per changed story, for decoding two images, comparing 1.08 million pixels, and encoding. `approve` and `accept` take about 0.2 s on the same store, including on a run of 541 whose directory had been deleted.

**The loop on the 30-story sample** takes about 4.8 s, of which capture is about 4.3 s, storing about 280 ms, and comparing about 1 ms. A CSS color change touching 10 of the 30 added about 175 ms of diff work.

## Recording only if necessary

**About 0.5 s.** Capture was about 65 s of a 70 s review of 541 unchanged stories, and storing about 4 s. What's left if a whole unchanged build is recognized is Git, opening the store, and the compare, whose parts measure in milliseconds, plus hashing the build. This is an estimate from those parts, and it wasn't built.
