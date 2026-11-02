# CLI — Rationale

> Informative companion to [cli.md](cli.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Commands

**Exit codes.** An agent branches on them, so 1 and 2 must never blur: 1 means "the answer is that something needs you", and 2 means "there is no answer". That is why a typo in `--story` that matches nothing at all is 2, while one typo beside a good pattern is 1: the second run did render something, and it would otherwise read as a pass.

**Everything is one document, including failures.** An agent that parses stdout shouldn't need a second path for the failure case. A build command's stdout could break that, so it goes to stderr.

## Local data

**A hash after the readable slug.** Slugifying is lossy: `a/b-c` and `a-b/c` read the same. Eight hex digits keep them apart, and since a slug always ends with them and never holds a dot, nothing can equal `d1.env`.

**One store across SSH and HTTPS.** Someone cloning a repository twice, once each way, is the same project with the same goldens. Dropping the port costs nothing real: two different repositories at one host and path, on two ports, is not worth a separate case.

## Review

**A dirty run is recorded, not refused.** Rendering uncommitted work is the point of the loop, and the run's `gitSha` is HEAD with `dirty` set. It can be compared and approved, and [`accept`](#accept) is where it stops.

**Stability is off by default.** It renders everything twice, which on 541 stories costs 199 s against 70 s, and agents run this constantly. Off, it must say so: a silent `unstable: 0` would read as "checked, and none".

**A gitignored build isn't dirty.** It usually is ignored, so counting it would make every review dirty. The cost is the [open question](cli.md#open-questions) about stale builds.

### What needs attention

**An approved change doesn't.** This is what makes "commit, review again, no re-approval" exit 0, and it's the behavior `docs/specs/system.md` → Approvals asks for. The change stays in `differences`, with who approved it, so nothing is hidden.

**A removal does, though no decision exists for it.** It takes `--removed` to accept, so a review that exits 0 mustn't be followed by an `accept` that refuses.

## Output directories

**Per-run directories rather than one reused one.** A reused directory would be smaller to describe, but a concurrent review, or an agent still reading the last review's images, would see files change underneath it. A run ID in the path also means a run's JSON keeps pointing at its own images.

**Twenty.** It is meant to outlast an agent's review, fix, review cycle within one task, and be small. Run directories only hold what differs: the 541-story review with nothing changed left 52 KB, holding the images of the 2 stories with `play` errors, and one with 130 changed stories left 14 MB, or about 110 KB per changed story. Twenty runs each changing all 541 would hold about 1.2 GB. A capture directory holds every story's PNG, so it can't outlive its review.

**The store still grows.** A run's rows are about 60 bytes each, per snapshot, and blobs grow only with new images, but nothing deletes either: `docs/specs/snapshots.md` → Open questions owns retention. After the 12 runs below and in the sample loop, holding 2,914 run rows and 650 images, `store.db` was 448 KB and `blobs/` 25 MB.

## Approve and reject

**The baseline comes from the run's record.** `compareRun` needs one to say which images are changed, and `find-baseline` could give a different answer later. The reviewer's decision should be about what the reviewer saw.

## Accept

**Refusing a run recorded on a dirty tree.** The dirty check alone isn't enough, since a run's images come from the moment it rendered: review with an edit in place, `git checkout .`, and the tree is clean while the run's images aren't that commit's. The same goes for reviewing dirty and committing, where the run's SHA is the commit before the edit. Either way a golden would misdescribe its SHA, which is what the dirty check exists to stop. It costs one more render after committing, and no approvals, since those carry over. `cli/test/commands.test.ts` covers both.

**Reporting every refusal at once.** An agent otherwise fixes one, runs again, and finds the next.

**No extra gate for a filtered run.** `acceptRun`'s count already catches it, and the refusal says which removals are only outside the filter. A person who wants a partial golden set can have one, and the rest read as new later, with their approvals intact.

## find-baseline

**A branch's own goldens aren't its baseline.** The README defines the baseline as a merge-base, so that a pull request's changes are reported against what it will merge into, cumulatively, however many commits it has. A branch accepting at its own commits doesn't move that. The cost is that a branch sees no baseline until someone accepts on the default branch, which is local to one machine until `sync`.

**First-parent history.** On a default branch, that is the commits it actually was, rather than whatever a merged branch passed through, whose goldens might describe unreviewed work.

**A limit of 1,000.** Each commit is one indexed local SQLite query. The bound is for a repository where nothing has goldens, and for `sync`, when these become cloud requests.

**Local candidates.** `main` and `master` are checked after `origin/*`, since an agent's scratch repository has no origin, and a clone's `origin/HEAD` is what names a different default.

## Configuration

**`selfie.config.json` found without being named.** Every command that needs an environment must find the same one, or `find-baseline` and `review` disagree. A file at the Git top level does that without a flag on each call.

**A config can't name a file outside itself.** A checkout's config file isn't the user's choice in the way a flag is. An init script is only ever run in the browser, with no network, so this is a small precaution at the cost of one check.

## End to end

**Measured 2026-11**, on a copy of dormouse's built Storybook (541 stories) in a scratch Git repository, on a Mac, in the pinned arm64 container, with `window.__ARGOS_SNAPSHOT__ = true` as the init script and 6 stories at once.

| 541-story review | Exit | Wall | Capture | Store | Compare | Diff |
|---|---|---|---|---|---|---|
| First, 512 new images, 29 unchanged | 1 | 71.5 s | 62.4 s | 8.8 s | 4 ms | 59 ms |
| Nothing changed, twice | 1 | 68.8 s, 70.4 s | 64.4 s, 66.0 s | 4.1 s, 4.1 s | 1 ms, 0 ms | 2 ms, 3 ms |
| 130 changed by a CSS color | 1 | 73.6 s | 66.1 s | 5.5 s | 2 ms | 1,668 ms |
| Nothing changed, `--stability` | 1 | 199.3 s | 194.9 s | 4.2 s | 1 ms | 3 ms |

Every row exits 1 because 2 of dormouse's stories have `play` errors, which is correct, and no story was unstable with the freeze on. Capture is most of the time, as `docs/specs/render.rationale.md` found. Storing costs about 7.6 ms per image to decode and hash, with images found by hash, and about 17 ms with one that's new. A diff costs about 13 ms per changed story, for decoding two images, comparing 1.08 million pixels, and encoding. `approve` and `accept` take about 0.2 s on the same store.

**The loop on the 30-story sample** takes about 4.7 s, of which capture is about 4.2 s, storing about 280 ms, and comparing about 2 ms. A CSS color change touching 10 of the 30 added 172 ms of diff work, which is about 17 ms per changed story.
