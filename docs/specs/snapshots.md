# Snapshots

> Status: built — the data layer for runs, comparisons, decisions, and goldens, on local SQLite and D1. `selfie review` calls it (`docs/specs/cli.md`), and so does the review UI (`docs/specs/ui.md`). See `## Future`.
>
> - See `docs/specs/glossary.md` for snapshot, snapshot name, run, decision, golden, and baseline.
> - Owns what a run holds, how a crash leaves one, snapshot states, decisions, and goldens. `docs/specs/system.md` owns why approvals carry through a push and why environments are part of a name. `docs/specs/store.md` owns image identity, image keys, and the `Sql` rules everything here obeys.

## Snapshot names

Source of truth: `store/src/core/snapshots.ts`; tests in `store/test/snapshots.test.ts`.

A name is two strings: `story` and `environment`.

- **Must treat both as opaque, compared exactly.** They come from the renderer. A render variant that isn't part of the environment goes in the story ID, in one canonical form its caller owns (rationale).
- **Must refuse either being empty or holding NUL.**
- **Must take the environment from the run, for every snapshot it holds.** Rows store only `story`, so a run can't mix environments.
- **Never compare a run with goldens, or apply a decision, from another environment.** Every such query takes its environment from the run.

## Runs

Source of truth: `store/src/core/snapshots.ts`; the contract suite is `store/test/contract/snapshots-contract.ts`.

A run is one recording of a set of snapshots against one full Git SHA in one environment. A SHA may have any number of runs, and each stays separate. A run keeps its `id` and times in every store that receives it, and **must refuse with `run-conflict` a different run under an ID already held**, since a run never changes.

| Status | Meaning | Compare | Accept |
|---|---|---|---|
| `recording` | Not finished: still being written, or its writer crashed | Refused | Refused |
| `failed` | Finished, and at least one story failed to render | Yes | Refused |
| `complete` | Finished, and every story rendered | Yes | If approved and not `dirty` |

- **Must be told when it begins whether the working tree was dirty, and the baseline its reviewer saw**, and may be told any story filter, as `patterns` and the `unmatched` among them, and which run really rendered its images, as `reusedFromRun` (`docs/specs/cli.md` → Recording only if necessary). A run keeps these for good, so nothing about it depends on a file outside the store.
- **Must be told its environment's scale when it begins**, as image pixels per CSS pixel, a positive number that need not be whole. The environment's ID is a hash, and the run's images hold only pixels, so this is the only place the store or a viewer can read it. It changes no state, comparison, or acceptance, since the ID already separates scales. **Must keep one image at its real pixels, and never a copy at another size**: a viewer calculates every size from the image and this.
- **Must treat `reusedFromRun` as a fact about where the pixels came from, and nothing more.** It changes no state, comparison, or acceptance, and it's an ID, not a reference, since sync may move a run without the one it names.
- **Must record a story that failed to render as a row with its failure message**, never leave it absent, so only a `recording` run can lack a story. A message is cut to 2,000 characters.
- **Must record a story's play error as a message, cut the same way, whether or not it also has an image.** It changes no state and no acceptance ([Open questions](#open-questions)).
- **Must refuse a snapshot whose image isn't stored**, so a row always has an image. Rows hold image keys, and the API only takes and returns image hashes, per `docs/specs/store.md` → Image identity.
- **Must let a run's newest result for a name replace the older one until it is finished**, and refuse any change after that, since a finished run may hold goldens.
- **Must mark a run finished only in a statement that counts its rows against the number the caller expected.** A batch that never landed fails that count, and the run stays `recording`.
- **Must refuse to compare a `recording` run**, since a snapshot it doesn't hold yet would read as removed.

### Crashes and retries

- **Must leave only states this table explains, after a failure at any point:**

| Failure | What is left | What to do |
|---|---|---|
| A process crashes while `recording`, at any point | A `recording` run, stopped for good, holding any part of its snapshots: on D1 a failed request may be rolled back, and on local SQLite its earlier statements stay | Start a new run. `runsAt` keeps listing the old one as `recording` |
| A `recordSnapshots` call fails, and the process lives | The same, with the run still usable | Send the same snapshots again |
| `finishRun` or `acceptRun` fails | Each statement is atomic, so the old state or the new | Call it again |
| A `decide` across requests fails | The earlier requests decided | Call it again |

- **Never resume a crashed run**, since nothing reads back what one holds. A run received from another store is the exception: `receiveRun` says how far it got, and its sender has all of it to send again.
- **Must mark every statement idempotent, and keep that true**: each returns the same rows and changes nothing further when resent after a lost response (`docs/specs/store.md` → Adapters). `finishRun` keeps its first finish time. `acceptRun` on the run already accepted succeeds whatever it is told. `decide` and `acceptRun` overwrite whatever is there, so a resend can undo another writer's change made since the first send (rationale).

## Compare

Source of truth: `Snapshots.compareRun` and `compareWithRun` in `store/src/core/snapshots.ts`.

- **Must compare by image alone: the same hash is the same image.** Pixel diffs belong to `selfie review` (`docs/specs/cli.md` → Review).
- **Must give each snapshot exactly one state**, of which `changed` and `new` are the ones `isDecidable`, having an image to decide on:

| State | The run has | The baseline's goldens have |
|---|---|---|
| `unchanged` | This image | This image |
| `changed` | This image | Another image |
| `new` | This image | Nothing, or there is no baseline |
| `failed` | A failure | Anything |
| `removed` | Nothing | An image |

- **Must list only what isn't `unchanged`, and anything with a play error, by default, with a count of every `unchanged` snapshot.** `includeUnchanged` lists them all (rationale).
- **`compareWithRun` must compare with a finished run in the run's environment**, whose images stand in for the goldens, and refuse any other with `no-baseline-run`. A story that run left out by a filter reads as `new`. **Never let `acceptRun` take a run as its baseline.**
- **Must refuse a baseline SHA that has no goldens in the run's environment**, rather than report everything as new. A null baseline means there are none yet, and gives `new` and `failed` only. That is what changing the environment starts from (`docs/specs/system.md`).
- **Must return the decision on exactly the run's image for that name**, whatever the state, so `selfie review` can show what is already approved.

## Decisions

Source of truth: `Snapshots.decide` in `store/src/core/snapshots.ts`.

A decision is an approval or a rejection, by an actor, at the time it is recorded.

- **Must record a decision against a snapshot's name and an image hash, and nothing else.** It holds in any run and at any Git SHA with that name and image, which is how an approval carries through a push (`docs/specs/system.md` → Approvals). It says nothing about any other image under that name.
- **Never key a decision by image key, run, or Git SHA**, so a future sync moves it as it is ([Future](#future)). A decision may name an image this store doesn't hold yet.
- **Must keep one decision per name and hash, the one most recently recorded.** There is no history of replaced decisions.
- **Must merge a decision from another store by its own time, latest first, then `rejected` before `approved`, and never by who made it**, so two stores reach one verdict whichever order they hear in, a person changing their mind still works, and sending a decision back can't change whose it is (rationale). `mergeDecisions` keeps what it's given, and `docs/specs/sync.md` owns what it's trusted with.

## Goldens

Source of truth: `Snapshots.acceptRun`, `hasCompleteGoldens`, `acceptedRunAt`, and `firstWithGoldens` in `store/src/core/snapshots.ts`.

Goldens are per Git SHA and environment, and are the images of the one run accepted there. A reader finds them as `goldenHash` in `compareRun`.

- **Must make a SHA's goldens exist whole or not at all**, so `hasCompleteGoldens` only asks whether a run was accepted there. A SHA with no accepted run has no goldens, however many of its images are approved (rationale).
- **Must accept only a `complete` run whose every image either matches the baseline's for that name or is approved at exactly that hash.** `acceptRun` otherwise returns false and changes nothing, and `compareRun` shows which. A null baseline means every image needs an approval.
- **Must refuse a run recorded on a dirty tree with `run-dirty`**, since a SHA's goldens must describe that commit, and this holds for every caller (rationale).
- **Must be told how many removed snapshots the reviewer saw, and must refuse a different number with `wrong-removed-count`**, so a filtered render or a discovery bug can't silently drop goldens. A removed snapshot needs no decision of its own, since no image is being accepted (rationale).
- **Must check and write in one statement**, so nothing can change between them.
- **Must let a later accepted run replace a SHA's goldens.** `acceptedRunAt` says which run's they are now.
- **Must let `adoptGoldens` take a run as a SHA's goldens without the checks of accepting, since the store that decides them made those, but never a `recording` or `failed` one, or one from a dirty tree.** It's only for `docs/specs/sync.md`.
- **May leave finding the SHA to the caller.** Nothing here runs Git. `selfie find-baseline` gives `firstWithGoldens` its merge-base candidates, nearest first (`docs/specs/cli.md` → find-baseline).
- **Must answer `firstWithGoldens` in the order asked, with one query per 99 SHAs, and none after the group holding the answer**, so a walk of 1,000 commits costs at most about 10 requests, and usually one.

## Schema

Source of truth: `CREATE_SNAPSHOT_TABLES` in `store/src/core/snapshots.ts`, `initStoreSchema` in `store/src/core/store.ts`.

```sql
runs(key PK, id UNIQUE, git_sha, environment, started_at, finished_at, failed_count, dirty, baseline_sha, story_filter, reused_from_run, scale)
  INDEX runs_by_sha(git_sha, environment, started_at)
run_snapshots(run_key, story, image_key, failure, play_error)  PK (run_key, story)  WITHOUT ROWID
decisions(environment, story, image_hash, decision, actor, decided_at)  PK (environment, story, image_hash)  WITHOUT ROWID
goldens(git_sha, environment, run_key)  PK (git_sha, environment)  WITHOUT ROWID
```

- **Must leave out the CLI's local table** (`docs/specs/cli.md` → Recording only if necessary): it's in a local `store.db`, not this schema, and D1 doesn't have it.
- **Must only add what is missing:** `initStoreSchema` is one request of `CREATE ... IF NOT EXISTS`, so running it upgrades a store holding only images. It changes no existing table, and there is no version number. Any other change needs `docs/specs/store.md` → Open questions decided first. `runs.reused_from_run` is the one exception, made before any project database existed (rationale): `CREATE TABLE IF NOT EXISTS` doesn't add it to an older store, whose reviews and accepts fail with exit 2 until the store is recreated.
- **Must keep `runs.key` and `run_snapshots.image_key` inside the store, as with image keys.** A run's `id`, a UUID, is what leaves it.
- **Never scan a table:** every statement reaches its rows through one of these keys. `store/test/snapshots.test.ts` checks SQLite's query plan for everything a review sends.

## Requests

Source of truth: `store/src/core/snapshots.ts`; `store/test/snapshots.test.ts` measures these at 10,000 snapshots.

- **Must send at most 400 statements per request, and at most 5,000 rows per page**, so that a run under 19,600 snapshots records in one request (rationale). A statement holds 49 snapshots, or as few as 33 if each has a play error, since each needs one more parameter.
- **Must run the model's contract against every SQL adapter.** `pnpm test` runs it on local SQLite with both parameter forms. In `store/`, `pnpm test:d1:snapshots` runs it on real D1 at about 90 requests, and `pnpm test:d1` runs it after the SQL contract (`docs/specs/store.md` → D1 REST adapter).

## Future

### Decisions on regions

A decision is on a name and a whole image today ([Decisions](#decisions)). **Scope: regions** (`docs/specs/cli.md` → Future) makes a whole-image decision the case of one region, and needs a key that survives what regions are for:

- Keyed by the content of both sides of a region, never by its position, so a shift doesn't orphan an approval, and a group's distance can't. A change to how regions are found can ask again, which fails safe.
- With the change it belongs to, as a branch and when it started, so an approval doesn't carry to another pull request.
- Taking any set of an image's regions, and approving their union, so a person can undo a split the differ got wrong, with no special case for one region or for all of them. Each region's approval stands on its own, so if a later push changes one of them, only that one asks again.
- With acceptance worked out from whether every region of an image is approved. A removed story becomes a region with no `after`, in place of the `--removed` count.

### Storing only what changed

Every run writes every row. At 10,000 snapshots a run and an assumed 100 runs a day, that is 30 million rows a month: about $30 a month in writes and about 1.37 GB a month in storage, which reaches D1's limit of 10 GB per database in about 220 days (rationale). Storing only what changed from a parent run fixes both, and it adds a parent pointer and read-through complexity to every query. It can wait, along with retention below, until a project gets close.

### Open questions

- **Retention.** Every run keeps its rows, and nothing deletes one. Deleting needs to keep any run a golden points at, and `docs/specs/store.md` → Image keys forbids reusing a key, so `runs` would need a rule of its own.
- **A reappearing image.** An approval never expires, so an image approved once under a name, later replaced, and later back again shows as approved. Decide whether a review should ask again (rationale).
- **Play errors and acceptance.** A story whose play function failed still has its image, which can be approved and accepted. `selfie review` reports it as an advisory (`docs/specs/cli.md` → What blocks).
- **What acknowledging a removal means.** `acceptRun` checks a count, so it catches a reviewer who wasn't shown the removals, and not one who was shown them and missed that they were wrong.
