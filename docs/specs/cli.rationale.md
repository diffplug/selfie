# CLI — Rationale

> Informative companion to [cli.md](cli.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Commands

**Blockers and advisories.** Dormouse has two stories with real `play` errors, so with every attention item counted, every review of it exited 1 forever, and 1 stopped meaning anything: an agent learns to ignore it, or can't tell the two errors it knew about from a new one. So `play` errors became advisories, which leave the exit code alone. The cost is the one the spec names, that a new `play` failure doesn't change the exit code. A blocker must be something accepting would refuse or a reviewer must decide, and a `play` error is neither. The user hasn't reviewed this.

**Exit 2 and a typo.** A pattern that matches nothing at all is 2, while one typo beside a good pattern is 1: the second run did render something, and would otherwise read as a pass.

**Everything is one document, including failures.** An agent that parses stdout shouldn't need a second path for the failure case. A build command's stdout could break that, so it goes to stderr. Timings are for people, so they went to stderr too.

**Two verbs rather than flags.** `--no-reuse` and `--stability` were flags on `review` because one verb did both jobs. Someone reviewing wants it as fast as possible, and someone recording wants a render, perhaps two a minute apart to look for flakiness, so each is a verb. The `--no-reuse` measurements here are what `selfie record` does now.

## Library

**Facts and verdicts apart.** The local review UI is the next caller. It approves images one at a time, and must show what's left after each without re-rendering, so whatever computes a verdict must take only what `compareRun` returns. `summarizeRun` does, and the CLI's `blockers`, `advisories`, `undecided`, and a refusal's lists all come from it, so they can't disagree.

**Coded errors.** A UI wanting to tell "no such run" from "not a repository" would otherwise be reading message text.

## Local data

**A hash after the readable slug.** Slugifying is lossy: `a/b-c` and `a-b/c` read the same. Eight hex digits keep them apart, and since a slug always ends with them and never holds a dot, nothing can equal `d1.env`.

**One store across SSH and HTTPS.** Someone cloning a repository twice, once each way, is the same project with the same goldens. Dropping the port costs nothing real: two different repositories at one host and path, on two ports, is not worth a separate case.

## Review

**A dirty run is recorded, not refused.** Rendering uncommitted work is the point of the loop. It can be compared and approved, and [`accept`](#accept) is where it stops.

**A gitignored built Storybook isn't dirty.** It usually is ignored, so counting it would make every review dirty. The cost is the [open question](cli.md#open-questions) about stale builds.

**`--baseline` exits 1 on any difference.** Blockers answer "what stops accepting this run", and two runs that differ can have every image approved. Someone looking for flakiness is asking what differs.

**A branch's goldens, only to look at.** Reviewing Selfie's own stories on a branch read every story as new, until a run was compared with the branch's own earlier goldens by hand. So a run with no baseline is shown against them. Nothing about acceptance moves: every image still needs its own approval, so an image matching a golden that someone has since rejected is still refused. So what's shown and what's checked can differ. Blockers and the exit code stay with what's checked, or a review could exit 0 before `accept` refused it, and the document's `baseline` stays the real one, with `comparedWith` saying what this review showed.

**Hunks, by a recursive 9-slice.** Whole-page render made any change in a page's height a size change, and a size change once compared nothing: on Selfie's own stories, moving one row put 5 of 18 changed stories there with nothing highlighted. Matching from the edges fixed that, but a heading changed near the top and rows moved near the bottom were then one band, where shifted rows ghost. Trimming all four sides and recursing gives the heading its own 182×18 box, and separates changes side by side, which rows alone can't.

**Why anchors must be unique.** The first prototype cut at the longest run of identical rows, and table rows matched the wrong table rows, pairing 27 rows of one image with 153 of the other. Requiring a row that appears once in each stopped that on Selfie's stories, and a story that had split into 11 hunks came out as 2.

**Moved and spacing.** Rows that line up only take a differ so far: a change in one column defeats them, so a list whose thumbnails changed height has its text shift beside them, and the shifted text ghosts, showing in pink twice over. On three real changes:

| Change | Stories | Changed pixels before | After | Only moves and spacing |
|---|---|---:|---:|---:|
| Selfie's own stories | 19 | 1,800,770 | 405,302 | 0 |
| Dormouse, a layout shift | 134 | 1,247,839 | 595,950 | 59 |
| Dormouse, a restyle | 290 | 337,008 | 328,104 | 0 |

It takes 4 to 10 ms an image on average, 17 ms at worst, and a story's stats come to 1 to 2 KB. Those are three changes in two projects, all at 1×.

**Why the account is checked.** Calling something moved can hide a change, so the claim isn't taken on trust. The current side is rebuilt from what was matched and compared with what's really there, and what the golden had that matched nothing counts too. Without that last part, deleting one block while moving another would read as nothing changed. Measured on the three changes above, it adds 175,318 changed pixels on Selfie's stories, 2,525 on the restyle, and 5,163 on the layout shift, and no story's label depends on it. It's the difference between a label that's usually right and one that can be relied on.

**Why a hunk must gain from it.** Rebuilding a hunk that was restyled counts its pixels on both sides, so taking moves everywhere made the restyle above 18% worse than comparing in place, in a prototype. Comparing whichever is better fixes that, and a hunk compared in place gives up its blocks, since its pixels are already judged where they are.

**Why matching crosses hunks.** Moving a button sideways leaves matching columns between where it was and where it is, so the 9-slice makes two hunks, and neither alone holds a move. The most obvious kind of move read as two changes until blocks could match across hunks.

**Why what spacing pushes along has stayed put.** A block's place is measured within its hunk, past any spacing. Measured in the image instead, everything below a gap that grew read as moved, and a page with a taller gap, a moved button, and a changed footer was blue from top to bottom, with the one thing that really moved lost in it.

**Why a block has a minimum size.** A single pixel identical to one elsewhere is a coincidence, and a row of little ones floods the document. Letting blocks of any size move gave 131 entries on the layout shift, against 75 at 9 pixels, for 593,522 changed pixels against 595,950, and the same 59 stories. 25 pixels was hardly different again, at 73 entries and 597,639, so 9 is what's small enough to keep a 3×3 bullet.

**Why spacing is tied to what's around it.** A solid row looks the same whether it's a gap that grew or a new banner. A band of the background, or of the color just outside it, can only read as a gap. A banner the color of what's around it, or one that grew, reads as spacing, which is what it looks like on the page too.

**Why moved stories still need a decision.** A layout shift can be the bug. The label says how little there is to look at, and the "Moved and spacing only" filter means a person can approve them all at once, but that's their decision to make. It also keeps what a run's blockers and exit code say from depending on how a differ reads pixels.

**Why the merge distance only groups.** It first changed the hunks themselves, which meant it changed diff images, two caches keyed without it, and any approval keyed by a hunk's content. So hunks are now a pure result of two images, and grouping happens when something is shown, so a project can change its distance freely.

**Why the cut sizes don't follow the scale.** A 2x render cuts at half the CSS size, which only makes hunks finer, and grouping follows the scale. Scaling the cuts would make a diff depend on more than its two images.

**Why the distance leans small.** On a style tweak to dormouse changing 290 of 541 stories, groups by distance totaled 1,694 at 12 px, 1,061 at 48, 693 at 96, and 467 at 200, with the most in one story falling from 19 to 6. Selfie's own two-edit change gave 2 at every distance. Much of dormouse's count is the four corners of a rounded button, whose middle didn't change. Someone can select groups to join them, and nothing yet splits one, so too many is the error to prefer.

### What blocks

**An approved change doesn't.** This is what makes "commit, review again, no re-approval" exit 0, and it's the behavior `docs/specs/system.md` → Approvals asks for. The change stays in `differences`, with who approved it, so nothing is hidden.

**A removal does, though no decision exists for it.** It takes `--removed` to accept, so a review that exits 0 mustn't be followed by an `accept` that refuses.

## Output directories

**Pruning loses no facts.** Run directories were first where a run's dirty flag and baseline lived, so pruning one stopped it being acted on, and made the rule against accepting dirty runs depend on a file. Those moved to the store (`docs/specs/snapshots.rationale.md` → Runs), and `review.json` can be deleted at any time.

**Per-run directories rather than one reused one.** A reused directory would be smaller to describe, but a concurrent review, or an agent still reading the last review's images, would see files change underneath it. A run ID in the path also means a run's JSON keeps pointing at its own images.

**Twenty.** It is meant to outlast an agent's review, fix, review cycle within one task, and be small. Run directories only hold what differs: the 541-story review with nothing changed left 48 KB, holding the images of the 2 stories with `play` errors, and one with 130 changed stories left 14 MB, or about 110 KB per changed story. Twenty runs each changing all 541 would hold about 1.2 GB. A render directory holds every story's PNG, so it can't outlive its review.

**The store still grows.** Blobs grow only with added images, but nothing deletes either them or a run's rows: `docs/specs/snapshots.md` → Open questions owns retention. After the 12 runs below and in the sample loop, holding 2,914 run rows and 650 images, `store.db` was 512 KB and `blobs/` 25 MB.

## Accept

**Only how the run was recorded.** The images come from the moment it rendered, so review with an edit in place, `git checkout .`, and the tree is clean while the run's images aren't that commit's. The same goes for reviewing dirty and committing, where the run's SHA is the commit before the edit. Either way a golden would misdescribe its SHA. A check of the tree as it is now adds nothing to that: a run recorded clean describes its SHA whatever has happened to the tree since. Refusing a dirty run costs one more render after committing, and no approvals, since those carry over. `cli/test/commands.test.ts` covers both.

**Reporting every refusal at once.** An agent otherwise fixes one, runs again, and finds the next.

**No extra gate for a filtered run.** `acceptRun`'s count already catches it, and the refusal says how many removals are only outside the filter. A person who wants a partial golden set can have one, and the rest read as new later, with their approvals intact.

**`usableAsBaseline`.** Accepting on a feature branch succeeds, and no later review reads the result, since a baseline comes from the default branch's history. That's correct by the README's definition, and surprising, so it's reported rather than refused. Off-branch goldens may still be wanted by a later sync.

## find-baseline

**A branch's own goldens aren't its baseline.** The README defines the baseline as a merge-base, so that a pull request's changes are reported against what it will merge into, cumulatively, however many commits it has. A branch accepting at its own commits doesn't move that. The cost was that a branch saw no baseline until someone accepted on the default branch, which is local to one machine until `sync`, and a project adopting Selfie on a branch had no commit it could accept at: its merge-base has no Storybook.

**First-parent history.** On a default branch, that is the commits it actually was, rather than whatever a merged branch passed through, whose goldens might describe unreviewed work.

**A limit of 1,000, asked in groups.** The bound is for a repository where nothing has goldens, and for `sync`, when these become cloud requests. An `IN` query of 99 SHAs makes that about 10 queries instead of 1,000, and one in the usual case, where a nearby commit has goldens.

**Local candidates.** `main` and `master` are checked after `origin/*`, since an agent's scratch repository has no origin, and a clone's `origin/HEAD` is what names a different default.

## Configuration

**One file, in one place.** Every command that needs an environment must find the same one, or `find-baseline` and `review` disagree. `--config` and `--init-script` let them, so they went. A file at the Git top level does the job without a flag on each call. `--native` stays, for a machine trying something locally, since a checked-in file shouldn't choose that.

**A build command in the config, only when asked.** This was once refused, since reading a command from a file lets a checkout run a shell, and rendering is otherwise safe on an untrusted one: stories run in a container with no network. But a project's build is a fact about that project, and retyping it is the friction `selfie` alone exists to remove. So it's in the config, and runs only for someone who asked for that build, by typing `selfie` or `--build`, and it prints first. What's given up: `selfie` in a stranger's checkout runs their command. `--no-build` is the way not to, and `selfie record`, `review`, and `ui` still never do it by themselves, so CI and agents can't run it by accident.


**A config can't name a file outside itself.** A checkout's config file isn't the user's choice in the way a flag is. An init script is only ever run in the browser, with no network, so this is a small precaution at the cost of one check.

## End to end

**Measured 2026-11**, on a copy of dormouse's built Storybook (541 stories) in a scratch Git repository, on a Mac, in the pinned arm64 container, with `window.__ARGOS_SNAPSHOT__ = true` as the init script in `selfie.config.json`, and 6 stories at once.

| 541-story review | Exit | Wall | Render | Store | Compare | Diff |
|---|---|---|---|---|---|---|
| First, 512 added images, 29 unchanged | 1 | 72.3 s | 63.1 s | 8.9 s | 2 ms | 56 ms |
| Nothing changed, twice | 0 | 68.6 s, 70.1 s | 64.2 s, 65.7 s | 4.2 s, 4.1 s | 1 ms, 1 ms | 3 ms, 3 ms |
| 130 changed by a CSS color | 1 | 73.9 s | 66.6 s | 5.3 s | 1 ms | 1,656 ms |

The exit 0 row lists dormouse's 2 `play` errors as advisories. Render is most of the time, as `docs/specs/render.rationale.md` found. Storing costs about 7.6 ms per image to decode and hash when it's already stored, and about 17 ms when it's new. A diff costs about 13 ms per changed story, for decoding two images, comparing 1.08 million pixels, and encoding. `approve` and `accept` take about 0.2 s on the same store, including on a run of 541 whose directory had been deleted.

**The loop on the 30-story sample** takes about 4.8 s, of which render is about 4.3 s, storing about 280 ms, and comparing about 1 ms. A CSS color change touching 10 of the 30 added about 175 ms of diff work.

## Recording only if necessary

**Measured 2026-11**, as in [End to end](#end-to-end), in the real container, on a scratch repository and a new store. On a reused run, "render" is hashing the built Storybook and reading the earlier run's rows, about 20 ms for 333 files and 12 MB, so a built Storybook many times this size still costs little beside a render.

| 541-story review | Exit | Wall | Render | Store | Diff |
|---|---|---|---|---|---|
| First, 541 new | 1 | 71.8 s | 62.4 s | 9.0 s | 64 ms |
| Rendered again with `--no-reuse`, nothing changed, twice | 0 | 70.1 s, 70.5 s | 65.7 s, 66.0 s | 4.1 s, 4.1 s | 4 ms, 3 ms |
| Same SHA, all still new, reused, twice | 1 | 0.38 s, 0.35 s | 20 ms, 20 ms | 37 ms, 37 ms | 57 ms, 54 ms |
| New commit, nothing changed, reused, twice | 0 | 0.25 s, 0.25 s | 21 ms, 20 ms | 16 ms, 16 ms | 1 ms, 1 ms |
| One byte of CSS, 80 stories changed | 1 | 70.2 s | 64.0 s | 4.8 s | 1,130 ms |
| That built Storybook again, reused | 1 | 1.36 s | 22 ms | 15 ms | 1,086 ms |
| Filtered to 30, answered from the whole run, twice | 0 | 0.25 s, 0.26 s | 23 ms, 22 ms | 12 ms, 13 ms | 1 ms, 1 ms |
| Filtered to 30, `--no-reuse`, to compare | 0 | 5.3 s | 4.8 s | 280 ms | 1 ms |

The estimate here was about 0.5 s, and the feature came in at about 0.25 s of wall time, of which about 85 ms is the review and the rest is starting Node.

**Reused results match a real render.** Two `--no-reuse` renders and three reused runs each held the same image hash, failure, and `play` error as the first render, on 541 of 541 stories. A reused review of the 80-story change listed the same stories, states, hashes, and pixel diffs as the render it reused.

**One byte can change nothing, and that's right.** Two one-byte edits of `iframe-*.css` made invalid values (`display:flew`, `background-colox`), rendered, and reported 0 changes: those rules are also in `pocket-chrome-*.css`, so the browser used the duplicate. `.bg-transparent` from `#0000` to `#000f` is valid in the last sheet loaded, and changed 80 stories. A miss only means a render happens: what it reports is the render's own answer.

**Do real builds reproduce? Yes, once two things are left out.** Measured by building each project repeatedly with no source change and comparing with `diff -r`, with `STORYBOOK_DISABLE_TELEMETRY=1`:

| Project | Builds | What differed |
|---|---|---|
| A minimal project, Storybook 10.6.5 and Vite 7.3.7: same directory, with `node_modules/.cache` cleared, and in a second directory with its own install | 4 | `project.json`'s `generatedAt`, every time |
| A copy of dormouse, Storybook 11.0.0-alpha.6 and Vite 8, 326 files and 546 stories, four of them with caches cleared | 6 | `project.json`'s `generatedAt`, every time. `manifests/components.html`'s `Generation took <strong>0.0s</strong>`, which read `0.1s` in some of them |

Without leaving these out, every built Storybook hashed differently and the feature would never have hit on rebuilt output. With them left out, all 4 and all 6 hash the same. In the real loop, `selfie review --build-command` running a real build of that copy reused the first render on every rebuild, including with its caches cleared, in about 3 s, of which about 2.8 s is the built Storybook. A one-line change to the copy's `.storybook/preview.css` rendered again, and putting it back reused the first render. That loop was measured before `docs/specs/render.md` → Render identity took over this hash, which kept the same exclusions.

**Why those two can't change pixels.** The worker only answers what the browser asks for, and no other file in either build names `project.json` or `manifests/components.html`, so no story loads them unless its own code fetches that path. So only those two exact pieces of text are left out, and the rest of both files still counts: a different `storybookVersion` in `project.json` misses, and so does the same text in any other file. If Storybook changes either format, the text stops matching and every built Storybook misses, which costs a render and nothing else.

**What this doesn't cover.** These are one machine's builds. A different machine doesn't share a local store anyway. `project.json`'s `userSince` didn't vary here, and would if Storybook's user cache were cleared, which would miss once. Webpack builds and builds with telemetry on weren't measured. A project whose build embeds its own timestamp or a Git SHA will miss every time it rebuilds: reuse then still helps when a build isn't rerun, and is otherwise no worse than rendering.

**All or nothing per build.** Knowing which stories a file can reach would take the built Storybook's module graph, and a wrong answer replays pixels a real render wouldn't produce.

**A failure is never replayed.** A story that timed out under load would otherwise fail forever on a built Storybook nobody changed, and the only way out would be a flag the agent has no reason to try. Only one more render is at stake.

**Which errors may be reused.** On dormouse's 541 stories, a real render's only errors were 2 `play` and the 2 `console` lines those same failures log. `play`, `console`, and `page` come from the project's own code, the same built Storybook repeats them, and none of them fails a story. `request` and the soft network `timeout` aren't reused: both can come from load, and neither is visible afterward, since a row doesn't record them. An allowed list means a new source starts out unreusable. The cost is that a project whose page always makes a failing off-origin request never reuses, and stderr names the story and the error. A `play` failure that depends on load is replayed too, which is a real gap: it stays listed as an advisory, and `--no-reuse` measures it again.

**A filter is answered only from a whole run.** A whole run holds every answer, and a filtered render is at most a few seconds, so it isn't worth a second key to remember one. On the 30-story sample a hit takes 0.25 s against 5.3 s, once a whole run of that built Storybook exists.

**A run's built Storybook isn't `render_keys`.** Those keys say what a later review may skip rendering, so they hold only a built Storybook's newest reusable render, and forget reused, filtered, and failed runs. `selfie ui` asked them first, and called all of those a different build. So a run says for itself, by a hash of the built Storybook's own files, since the environment and the renderer's code don't change whether a story's page is the one in the image.

**Provenance is on the run, and the key is local.** `reused_from_run` is a fact about the run, which `accept`, the UI, and later `trust` all want, so it's read with the run, with no second lookup. `render_keys` is only what this machine rendered, which nothing in the cloud needs. It must outlive a pruned `review.json`, and in `store.db` it lives and dies with the runs it names. After 15 runs here it held 2 rows.

**A column added to `runs`, against the rule.** `docs/specs/store.md` → Open questions allows only new tables and indexes until migrations are decided, and `CREATE TABLE IF NOT EXISTS` can't add a column. It was made anyway since no project database holds this schema yet, and a separate table was the alternative. On a copy of an older store, `selfie review` renders and then fails with exit 2, `table runs has no column named reused_from_run`, and `accept` fails with `no such column: reused_from_run`. Anyone with a store from before this has to delete it.

**`scale`, another column on `runs`.** The same exception, for the same reason, and it comes in the same unmerged stack, so it breaks no store that `reused_from_run` hadn't already. It's a fact about one run that every viewer wants with the run, so a separate table would only add a lookup.

**A run at this commit needs no copy.** A review repeated at one commit used to copy every row into a new run, for nothing. A new commit still needs its own run, since goldens are per SHA, and so does a tree that became dirty or a baseline that moved, since a run records both.

**The newest real render wins.** Pointing a key at the newest reused run would let `reusedFromRun` name a run that rendered nothing, so reuse never chains. Forgetting a key after a bad render means `--no-reuse` can't uncover a deterministic failure only to have the next review hide it behind an older pass.

**What a reused run can't change.** It's still only as good as its built Storybook. A clean tree with a stale gitignored build records stale pixels against the new SHA whether or not it renders, so reuse neither fixes nor worsens [that open question](cli.md#open-questions).

**What a diff cache would save.** A reused run with 80 changes spent 1,086 ms of its 1.36 s on diffs it had already computed, about 13 ms a story, which is why it stays in `docs/specs/cli.md` → Future.

**What copying rows costs.** Each reused run writes 541 rows. A review of this feature estimated about 450 MB a year at 50 hits a day. In the store above, `run_snapshots` held 5,560 rows in 376,832 bytes by `dbstat`, or 68 bytes a row including page overhead and 2 stories' `play` messages, which comes to about 670 MB for the same 18,250 runs. Either is small beside D1's 10 GB, and these rows are local, but it has no bound, as `docs/specs/snapshots.md` → Storing only what changed says of every run.

## selfie alone

**Building only on the way up.** Later builds are the agent's own, with `--build`, since a page must not be able to run a shell. The config is read first, since a bad one would otherwise cost a whole built Storybook to find out.

**Opening a browser here, and not from `selfie ui`.** `selfie` alone is what a person types to look at something. `selfie ui` is also what an agent runs, and a browser opening on it would be a surprise. A terminal is what tells a person from the rest.

## Flakes

**Why a command, when `review --baseline` already compares two runs.** That records runs, and compares just two, and a run keeps only a render's `play` errors. So the network wait on two stories showed as one line naming one of them, and nothing showed for a play failure that came and went. Measured on this repository's 134 stories, 2026-11: comparing four whole runs that way took about 3 minutes, and gave no way to see the rest.

**What counts.** A `play`, `console`, or `page` error in every render is the project's own code being wrong in the same way, which `review` already says. In only some renders, it's a flake. A `timeout` or a `request` error counts even in every render: the image may be the same each time so far, but it only got there by running out the wait.

**What the first real use found.** 31 of 134 stories differed across four renders, and two more ran out the network wait in every one. The causes were few. Each count is from the measure that found it, since each fix let the next one show:

| Stories | What differed | Cause |
|---|---|---|
| 21 | Whole pages, delta 255 | A Primer pane with a named width, which came out at 256 or 296. Numbers fixed it. Primer does limit a named width by the window, which is the likely way, but a probe of `innerWidth` on a plain page never read small, so why isn't pinned down |
| 2 | The network wait, every render | A renderer bug: a directory with no `index.html` was never answered |
| 7, and more on later measures | 8 to 18 pixels, delta 1, at the corners of images | A background showing through a rounded border's antialiased edge. With `background: none`, these were gone across 8 renders, and the corners stayed rounded |
| 2 | One image, below the fold, delta up to 248 | `loading="lazy"` and `decoding="async"`, which the renderer now handles for any project |
| 1 | 30 px bands at the top and bottom of a scroller, delta 9, only under load | A real bug: centering ran once the shown image had a size, so where it landed depended on which image loaded first |
| 1 | A play failure, in 2 of 5 renders | `findByRole` retried finding a dialog's text box, and not asserting it's visible |

So the skill says to look at pictures and group first, since working down the list by story would have meant the same fix 21 times. It's why the skill's table is by symptom too.

**A skill's table comes from real cases.** A list of everything that could flake reads well and sends an agent looking for causes that aren't there. Some rows came from the renderer's own design, such as what it already freezes, and those say so.
