# Snapshots

> Status: built — the data layer for runs, comparisons, decisions, and goldens, on local SQLite and D1. Nothing calls it yet; `selfie review` and the review UI come next. See `## Future`.
>
> - See `docs/specs/glossary.md` for snapshot, snapshot name, run, decision, golden, and baseline.
> - Owns what a run holds, how a crash leaves one, snapshot states, decisions, and goldens. `docs/specs/system.md` owns why approvals carry through a push and why environments are part of a name. `docs/specs/store.md` owns image identity, image keys, and the `Sql` rules everything here obeys.

## Snapshot names

Source of truth: `store/src/core/snapshots.ts`; tests in `store/test/snapshots.test.ts`.

A name is three strings: `story`, `settings`, and `environment`.

- **Must treat all three as opaque, compared exactly.** The environment ID and story ID come from the renderer. `settings` is whatever render settings aren't part of the environment, in one canonical form its caller owns, and empty when there are none.
- **Must refuse an empty story or environment, and NUL in any of the three.**
- **Must take the environment from the run, for every snapshot it holds.** Rows store only `story` and `settings`, so a run can't mix environments.
- **Never compare a run with goldens, or apply a decision, from another environment.** Every such query takes its environment from the run.

## Runs

Source of truth: `store/src/core/snapshots.ts`; the contract suite is `store/test/contract/snapshots-contract.ts`.

A run is one recording of a set of snapshots against one full Git SHA in one environment. A SHA may have any number of runs, and each stays separate.

| Status | Meaning | Compare | Accept |
|---|---|---|---|
| `recording` | Not finished: still being written, or its writer crashed | Refused | Refused |
| `failed` | Finished, and at least one story failed to render | Yes | Refused |
| `complete` | Finished, and every story rendered | Yes | If approved |

- **Must record a story that failed to render as a row with its failure message**, never leave it absent, so only a `recording` run can lack a story. A message is cut to 2,000 characters.
- **Must refuse a snapshot whose image isn't stored**, so a row always has an image. Rows hold image keys, and the API only takes and returns image hashes, per `docs/specs/store.md` → Image identity.
- **Must let a run's newest result for a name replace the older one until it is finished**, and refuse any change after that, since a finished run may hold goldens.
- **Must mark a run finished only in a statement that counts its rows against the number the caller expected.** A batch that never landed fails that count, and the run stays `recording`.
- **Must refuse to compare a `recording` run**, since a snapshot it doesn't hold yet would read as removed.

### Crashes and retries

- **Must leave only states this table explains, after a crash at any point:**

| Crash | What is left | What to do |
|---|---|---|
| Before or during `beginRun` | No run, or one with no rows | Start again |
| During `recordSnapshots` | A `recording` run holding some of the snapshots: on D1 a failed request may be rolled back, and on local SQLite its earlier statements stay | Send them again, or only what `listSnapshots` lacks |
| Before `finishRun` | A `recording` run holding all of them | Call `finishRun` |
| During `finishRun`, `decide`, or `acceptRun` | Each statement is atomic, so the old state or the new. A `decide` across requests leaves the earlier ones decided | Call it again |

- **Must mark every statement idempotent, and keep that true**: each returns the same rows and changes nothing further when run again (`docs/specs/store.md` → Adapters). `finishRun` keeps its first finish time.
- **Must find a crashed run through `runsAt`**, which lists a SHA's runs in an environment, newest first, with their status. A caller resumes one, or starts a new run and leaves it.

## Compare

Source of truth: `Snapshots.compareRun` in `store/src/core/snapshots.ts`.

- **Must compare by image alone: the same hash is the same image.** Pixel diffs are a later step ([Future](#future)).
- **Must give each snapshot exactly one state:**

| State | The run has | The baseline's goldens have |
|---|---|---|
| `unchanged` | This image | This image |
| `changed` | This image | Another image |
| `new` | This image | Nothing, or there is no baseline |
| `failed` | A failure | Anything |
| `removed` | Nothing | An image |

- **Must refuse a baseline SHA that has no goldens in the run's environment**, rather than report everything as new. A null baseline means there are none yet, and gives `new` and `failed` only. That is what changing the environment starts from (`docs/specs/system.md`).
- **Must return the decision on exactly the run's image for that name**, whatever the state, so `selfie review` can show what is already approved.

## Decisions

Source of truth: `Snapshots.decide` in `store/src/core/snapshots.ts`.

A decision is an approval or a rejection, by an actor, at a time.

- **Must record a decision against a snapshot's name and an image hash, and nothing else.** It holds in any run and at any Git SHA with that name and image, which is how an approval carries through a push (`docs/specs/system.md` → Approvals). It says nothing about any other image under that name.
- **Never key a decision by image key, run, or Git SHA**, so a future sync moves it as it is ([Future](#future)). A decision may name an image this store doesn't hold yet.
- **Must keep one decision per name and hash: the one latest by its time, with ties going to the higher of `decision` then `actor`, as text**, which makes a rejection beat an approval made in the same millisecond. Order doesn't matter, so any store receiving the same decisions in any order agrees (rationale).
- **Must keep no history of replaced decisions.**

## Goldens

Source of truth: `Snapshots.acceptRun`, `hasCompleteGoldens`, and `goldens` in `store/src/core/snapshots.ts`.

Goldens are per Git SHA and environment, and are the images of the one run accepted there.

- **Must make a SHA's goldens exist whole or not at all**, so `hasCompleteGoldens` only asks whether a run was accepted there. A SHA with no accepted run has no goldens, however many of its images are approved (rationale).
- **Must accept only a `complete` run whose every image either matches the baseline's for that name or is approved at exactly that hash.** `acceptRun` otherwise returns false and changes nothing, and `compareRun` shows which. A null baseline means every image needs an approval.
- **Must check and write in one statement**, so no decision can change between them.
- **Must not need a decision for a `removed` snapshot**, since no image is being accepted.
- **Must let a later accepted run replace a SHA's goldens**, unless the one there was accepted later by its own clock, so a resent older acceptance can't overwrite a newer one.
- **May leave finding the SHA to the caller.** Nothing here runs Git. Reserved: `find-baseline` asks `hasCompleteGoldens` of each merge-base candidate ([Future](#future)).

## Schema

Source of truth: `CREATE_SNAPSHOT_TABLES` in `store/src/core/snapshots.ts`, `initStoreSchema` in `store/src/core/store.ts`.

```sql
runs(key PK, id UNIQUE, git_sha, environment, started_at, finished_at, snapshot_count, failed_count)
  INDEX runs_by_sha(git_sha, environment, started_at)
run_snapshots(run_key, story, settings, image_key, failure)  PK (run_key, story, settings)  WITHOUT ROWID
decisions(environment, story, settings, image_hash, decision, actor, decided_at)  PK (environment, story, settings, image_hash)  WITHOUT ROWID
goldens(git_sha, environment, run_key, accepted_at)  PK (git_sha, environment)  WITHOUT ROWID
```

- **Must only add what is missing:** `initStoreSchema` is one request of `CREATE ... IF NOT EXISTS`, so running it upgrades a store holding only images. It changes no existing table, and there is no version number. Any other change needs `docs/specs/store.md` → Open questions decided first.
- **Must keep `runs.key` and `run_snapshots.image_key` inside the store, as with image keys.** A run's `id`, a UUID, is what leaves it.
- **Never scan a table:** every statement reaches its rows through one of these keys. `store/test/snapshots.test.ts` checks SQLite's query plan for everything a review sends.

## Requests

Source of truth: `store/src/core/snapshots.ts`; `store/test/snapshots.test.ts` measures these at 10,000 snapshots.

- **Must send at most 400 statements per request, and at most 5,000 rows per page**, so that a run under 13,200 snapshots records in one request (rationale).
- **Must run the model's contract against every SQL adapter.** `pnpm test` runs it on local SQLite with both parameter forms. `pnpm test:d1:snapshots` runs it on real D1 at about 50 requests, and `pnpm test:d1` runs it after the SQL contract (`docs/specs/store.md` → D1 REST adapter).

## Future

**Scope: sync** is defined in `docs/specs/system.md` → Build order. This layer has `decide`, which takes the original time and actor, and is commutative for that purpose. It still needs:

- A way to list decisions to send, by environment or since a time.
- Moving a golden set between stores: rows by name and image hash, under a run in the receiving store.
- Deciding whether two stores' clocks can be trusted for the order of decisions, since the latest by its own clock wins (rationale).

**Scope: cli-review** and **Scope: local-review** are defined in `docs/specs/system.md` → Build order. Pixel diffs and image paths belong to them.

### Open questions

- **Retention.** Every run keeps its rows, and nothing deletes one. Deleting needs to keep any run a golden points at, and `docs/specs/store.md` → Image keys forbids reusing a key, so `runs` would need a rule of its own.
- **A reappearing image.** An approval never expires, so an image approved once under a name, later replaced, and later back again shows as approved. Decide whether a review should ask again (rationale).
- **Unstable stories.** The renderer can flag a story that renders differently twice. A run doesn't record that yet, so `selfie review` must decide whether an unstable image can be approved.
