# RenderBatches

> Status: built — the data layer for batches, comparisons, decisions, and approvals, on local SQLite and D1. `selfie review` calls it (`docs/specs/cli.md`), and so does the review UI (`docs/specs/ui.md`). Goldens remain for `docs/specs/sync.md` alone. See `## Future`.
>
> - See `docs/specs/glossary.md` for render, render name, batch, decision, approval, reference, and golden.
> - Owns what a batch holds, how a crash leaves one, render states, decisions, approvals, and goldens. `docs/specs/system.md` owns why approvals carry through a push and why environments are part of a name. `docs/specs/store.md` owns image identity, image keys, and the `Sql` rules everything here obeys.

## Render names

Source of truth: `store/src/core/render-batches.ts`; tests in `store/test/render-batches.test.ts`.

A name is two strings: `story` and `environment`.

- **Must treat both as opaque, compared exactly.** They come from the renderer. A render variant that isn't part of the environment goes in the story ID, in one canonical form its caller owns (rationale).
- **Must refuse either being empty or holding NUL.**
- **Must take the environment from the batch, for every render it holds.** Rows store only `story`, so a batch can't mix environments.
- **Never compare a batch with a reference or goldens, or apply a decision, from another environment.** Every such query takes its environment from the batch.

## Render batches

Source of truth: `store/src/core/render-batches.ts`; the contract suite is `store/test/contract/render-batches-contract.ts`.

A batch is one recording of a set of renders against one full Git SHA in one environment. A SHA may have any number of batches, and each stays separate. A batch keeps its `id` and times in every store that receives it, and **must refuse with `batch-conflict` a different batch under an ID already held**, since a batch never changes.

| Status | Meaning | Compare | Accept |
|---|---|---|---|
| `recording` | Not finished: still being written, or its writer crashed | Refused | Refused |
| `failed` | Finished, and at least one story failed | Yes | Refused |
| `complete` | Finished, and every story rendered | Yes | If approved and not `dirty` |

- **Must be told when it begins whether the working tree was dirty, and which branch HEAD was on, or null if detached**, and may be told any story filter, as `patterns` and the `unmatched` among them, and which batch really rendered its images, as `reusedFromBatch` (`docs/specs/cli.md` → Recording only if necessary). A batch keeps these for good, so nothing about it depends on a file outside the store.
- **Must be told its environment's scale when it begins**, as image pixels per CSS pixel, a positive number that need not be whole. The environment's ID is a hash, and the batch's images hold only pixels, so this is the only place the store or a viewer can read it. It changes no state, comparison, or acceptance, since the ID already separates scales. **Must keep one image at its real pixels, and never a copy at another size**: a viewer calculates every size from the image and this.
- **Must treat `reusedFromBatch` as a fact about where the pixels came from, and nothing more.** It changes no state, comparison, or acceptance, and it's an ID, not a reference, since sync may move a batch without the one it names.
- **Must record a story that failed to render as a row with its failure message**, never leave it absent, so only a `recording` batch can lack a story. A message is cut to 2,000 characters.
- **Must record a story that rendered and then failed, such as by its play function throwing, with both its image and its failure**, so what it looked like is there to work out why. It's `failed` like any other, and `failure` is what says a story failed (`docs/specs/cli.md` → What blocks).
- **Must refuse a render whose image isn't stored**, so a row's image is always here. A `CHECK` requires a row to have an image, a failure, or both. Rows hold image keys, and the API only takes and returns image hashes, per `docs/specs/store.md` → Image identity.
- **Must let a batch's newest result for a name replace the older one until it is finished**, and refuse any change after that, since a finished batch may hold goldens. **May set `storybook_key` after that**, since it's only known once a built Storybook is kept, and changes nothing a comparison reads.
- **Must mark a batch finished only in a statement that counts its rows against the number the caller expected.** A batch that never landed fails that count, and the batch stays `recording`.
- **Must refuse to compare a `recording` batch**, since a render it doesn't hold yet would read as removed.

### Crashes and retries

- **Must leave only states this table explains, after a failure at any point:**

| Failure | What is left | What to do |
|---|---|---|
| A process crashes while `recording`, at any point | A `recording` batch, stopped for good, holding any part of its renders: on D1 a failed request may be rolled back, and on local SQLite its earlier statements stay | Start a new batch. `batchesAt` keeps listing the old one as `recording` |
| A `recordRenders` call fails, and the process lives | The same, with the batch still usable | Send the same renders again |
| `finishBatch` or `acceptBatch` fails | Each statement is atomic, so the old state or the new | Call it again |
| A `decide` across requests fails | The earlier requests decided | Call it again |

- **Never resume a crashed batch**, since nothing reads back what one holds. A batch received from another store is the exception: `receiveBatch` says how far it got, and its sender has all of it to send again.
- **Must mark every statement idempotent, and keep that true**: each returns the same rows and changes nothing further when resent after a lost response (`docs/specs/store.md` → Adapters). `finishBatch` keeps its first finish time. `acceptBatch` on the batch already accepted succeeds whatever it is told. `decide` and `acceptBatch` overwrite whatever is there, so a resend can undo another writer's change made since the first send (rationale).

## Compare

Source of truth: `compareWithApprovals` and `RenderBatches.compareFromHistory`, `compareBatch`, and `compareWithBatch` in `store/src/core/render-batches.ts`.

- **Must compare by image alone: the same hash is the same image.** Pixel diffs belong to `selfie review` (`docs/specs/cli.md` → Review).
- **Must give each render exactly one state**, of which `changed`, `added`, and `removed` are the ones `isDecidable`:

| State | The batch has | Its reference is |
|---|---|---|
| `unchanged` | This image | This image |
| `changed` | This image | Another image |
| `added` | This image | Nothing |
| `failed` | A failure, and maybe an image | Anything |
| `removed` | Nothing | An image |

- **Must list only what isn't `unchanged`, by default, with a count of every `unchanged` render.** `includeUnchanged` lists them all (rationale).
- **`compareWithBatch` must compare with a finished batch in the batch's environment**, whose images stand in for the reference, and refuse any other with `no-baseline-batch`. A story that batch left out by a filter reads as `added`. **Never let `acceptBatch` take a batch as its baseline.**
- **`compareBatch`, which only sync uses, must refuse a baseline SHA that has no goldens in the batch's environment**, rather than report everything as added. A null baseline means there are none yet, and gives `added` and `failed` only.
- **Must return the decision on exactly the batch's image for that name, or on the story being gone**, whatever the state, so `selfie review` can show what is already approved. `compareFromHistory` takes the decisions from `decisionsAt`, and returns one only if it's no older than the reference's approval ([Approvals](#approvals)).

## Decisions

Source of truth: `RenderBatches.decide` in `store/src/core/render-batches.ts`.

A decision is an approval or a rejection, by an actor, at the time it is recorded.

- **Must record a decision against a render's name, an image hash or a removal, and the commit and batch it was made on.** A removal is a decision with no image, stored as an empty image hash.
- **Must keep one decision per name, hash, and commit, the one most recently recorded.** There is no history of replaced decisions.
- **Must merge a decision from another store by its own time, latest first, then `rejected` before `approved`, and never by who made it**, so two stores reach one verdict whichever order they hear in, a person changing their mind still works, and sending a decision twice changes nothing. It keeps its commit and batch there, so history reaches it as it would here.
- **May name an image this store doesn't hold yet.**

## Approvals

Source of truth: `compareWithApprovals` and `RenderBatches.compareFromHistory` in `store/src/core/render-batches.ts`, which is the rule; `reachableCommits` in `cli/src/project.ts`, which is what history reaches. Tests in `store/test/approvals-from-history.test.ts` and `cli/test/approvals.test.ts`.

**A story's reference at a commit is the image of its newest approval that commit's history reaches.** Nothing has to be accepted, promoted, or rendered again on the default branch.

- **Must reach, from a batch: its commit's ancestors through every parent, up to 1,000 commits, and if it's on a branch other than the default, every commit its branch's batches were recorded at, from the earliest author time of the commits that branch has and the default doesn't, up to when this batch started** (rationale). A branch with no commits of its own reaches only its ancestors. A detached batch reaches only its ancestors. A commit this clone doesn't have reaches only itself.
- **Must leave Git to the caller.** The store is told which commits are reachable, and runs no Git.
- **Must leave out approvals made on the batch being compared**, or a story would read as unchanged the moment someone approved it, and vanish from its review. Later batches see them, including later ones at the same commit (rationale).
- **Must count an image's decision only if it's no older than the reference's approval**, so a bug that brings back an image approved long ago asks again, and a rejection of an older image doesn't stick to a newer reference (rationale).
- **Must let a rejection leave the reference alone, unless it replaces the approval of that image at that commit**, which is how a person takes one back ([Decisions](#decisions)). Otherwise it only says what's blocked.
- **Must make a removal a decision like any other.** Once approved, the story has no reference for later batches, and reads as `added` if it comes back.
- **Never read a story that a batch's filter left out as gone.** It's for `summarizeBatch` to set these apart (`docs/specs/cli.md` → What blocks), and they take no decision.
- **Must let a batch recorded on a dirty tree take approvals**, which count from its commit.
- **Must read one commit list as one statement**, however long, so that history isn't a statement per commit (rationale).

## Goldens

Source of truth: `RenderBatches.acceptBatch`, `acceptedBatchAt`, and `firstWithGoldens` in `store/src/core/render-batches.ts`.

Goldens are per Git SHA and environment, and are the images of the one batch accepted there. Only `docs/specs/sync.md` still uses them: nothing local makes or reads them but `selfie pull`, and it reads no comparison from them. A reader finds them as `goldenHash` in `compareBatch`.

- **Must make a SHA's goldens exist whole or not at all**, so `acceptedBatchAt` only asks whether a batch was accepted there. A SHA with no accepted batch has no goldens, however many of its images are approved (rationale).
- **Must accept only a `complete` batch whose every image either matches the baseline's for that name or is approved at exactly that hash.** `acceptBatch` otherwise returns false and changes nothing, and `compareBatch` shows which. A null baseline means every image needs an approval.
- **Must refuse a batch recorded on a dirty tree with `batch-dirty`**, since a SHA's goldens must describe that commit, and this holds for every caller (rationale).
- **Must be told how many removed renders the reviewer saw, and must refuse a different number with `wrong-removed-count`**, so a filtered render or a discovery bug can't silently drop goldens. A removed render needs no decision of its own, since no image is being accepted (rationale).
- **Must check and write in one statement**, so nothing can change between them.
- **Must let a later accepted batch replace a SHA's goldens.** `acceptedBatchAt` says which batch's they are now.
- **Must let `adoptGoldens` take a batch as a SHA's goldens without the checks of accepting, since the store that decides them made those, but never a `recording` or `failed` one, or one from a dirty tree.** It's only for `docs/specs/sync.md`.
- **May leave finding the SHA to the caller.** Nothing here runs Git. `selfie pull` gives `firstWithGoldens` its merge-base candidates, nearest first.
- **Must answer `firstWithGoldens` in the order asked, with one query per 99 SHAs, and none after the group holding the answer**, so a walk of 1,000 commits costs at most about 10 requests, and usually one.

## Schema

Source of truth: `CREATE_BATCH_TABLES` in `store/src/core/render-batches.ts`, `initStoreSchema` in `store/src/core/store.ts`.

```sql
render_batches(key PK, id UNIQUE, git_sha, environment, started_at, finished_at, failed_count, dirty, story_filter, reused_from_batch, scale, viewport_width, viewport_height, branch, storybook_key → built_storybooks.key)
  INDEX batches_by_sha(git_sha, environment, started_at)
  INDEX batches_by_branch(branch, environment, started_at)
renders(batch_key → render_batches.key, story, image_key → images.key, failure, viewport_width, viewport_height)  PK (batch_key, story)  WITHOUT ROWID
decisions(environment, story, image_hash, decision, actor, decided_at, git_sha, batch_id)  PK (environment, story, image_hash, git_sha)  WITHOUT ROWID
  INDEX decisions_by_commit(environment, git_sha)
goldens(git_sha, environment, batch_key → render_batches.key)  PK (git_sha, environment)  WITHOUT ROWID
```

- **Must leave out the CLI's local table** (`docs/specs/cli.md` → Recording only if necessary): it's in a local `store.db`, not this schema, and D1 doesn't have it.
- **Must only add what is missing:** `initStoreSchema` is one request of `CREATE ... IF NOT EXISTS`, so running it upgrades a store holding only images. It changes no existing table, and there is no version number. Any other change needs `docs/specs/store.md` → Open questions decided first. `render_batches.reused_from_batch`, the rename of its tables and columns (`docs/specs/cli.rationale.md`), and its foreign keys are the exceptions, made before any project database existed (rationale): `CREATE TABLE IF NOT EXISTS` doesn't add it to an older store, whose reviews and accepts fail with exit 2 until the store is recreated.
- **Must declare a foreign key wherever a row's parent is always written first and held here**, as `→` shows above, so a store refuses an orphan instead of holding one (rationale).
- **Never declare one on `decisions` or `reused_from_batch`**, since a decision may name an image or batch this store doesn't hold, and sync may move a batch without the one it was reused from.
- **Must say in `render_batches.viewport_width` and `viewport_height` the window a batch's stories lay out in, in CSS pixels, and in those columns of `renders` only a story's own, if it differs**, both or neither, so a story with neither laid out in its batch's (`docs/specs/render.md` → A story's viewport). They only size a story running live, so a comparison never reads them (rationale). **A batch reusing another's images must hold the same sizes.**
- **Must keep `render_batches.key` and `renders.image_key` inside the store, as with image keys.** A batch's `id`, a UUID, is what leaves it.
- **Never scan a table:** every statement reaches its rows through one of these keys. `store/test/render-batches.test.ts` checks SQLite's query plan for everything a review sends.

## Requests

Source of truth: `store/src/core/render-batches.ts`; `store/test/render-batches.test.ts` measures these at 10,000 renders.

- **Must send at most 400 statements per request, and at most 5,000 rows per page**, so that a batch under 19,600 renders records in one request (rationale). A statement holds 49 renders, or as few as 19 if each has an image, a failure, and a window of its own, since each of those needs more parameters.
- **Must run the model's contract against every SQL adapter.** `pnpm test` runs it on local SQLite with both parameter forms. In `store/`, `pnpm test:d1:render-batches` runs it on real D1 at about 90 requests, and `pnpm test:d1` runs it after the SQL contract (`docs/specs/store.md` → D1 REST adapter).

## Future

### Approvals from history in the cloud

**Scope: approvals-sync** — The local half is built ([Approvals](#approvals)). What's left, which replaces the goldens above:

- A commit's history also reaches the commits of any pull request merged at one of its ancestors, whatever they were, since a squash, a rebase, or a force-push leaves them out of Git's history. Before a merge, it reaches its own pull request's commits. A pull request ties a branch to its merge commit when it merges.
- A removal's decision goes across sync, which only sends decisions on a batch's images.
- A pull request's check is red if a story failed, yellow if anything's undecided, and green if every story matches its reference.
- Then these go: `POST /goldens`, the goldens table, `acceptBatch`, `compareBatch`, `adoptGoldens`, and `firstWithGoldens`.

Open:

- Whether the reference needs a derived table for the cloud. Locally it doesn't (rationale). If it does, that table can always be rebuilt, and is never a source of truth.
- With no remote, a squash or a rebase onto the default branch leaves no pull request to follow, so its approvals are out of reach, and it asks again. A commit whose Git tree matches an approved batch's commit might carry them.
- A shallow clone can't walk its history, so CI needs a full clone, or to ask the store.
- An approval on a branch with no commits of its own lands on a commit the default branch also has, so it counts there too.

### Decisions on hunks

**Scope: hunks** (`docs/specs/cli.md` → Future) adds a hunk approval beside an [approval of a render](#approvals), and these are different things. A render's approval is the durable judgment, on a story, an image's hash, and a commit. A hunk approval is short-lived work towards one:

- Keyed by the content of both sides of a hunk, never by its position, so a shift doesn't orphan an approval, and a group's distance can't. A new image on either side, or a change to how hunks are found, can ask again, which fails safe.
- Tied, locally, to a branch, a working folder, and a time, as a note's session is tied to its folder (`docs/specs/feedback.md`), so another worktree of the same branch doesn't share them. In the cloud, to a pull request and a time.
- Never crosses a merge or goes to another pull request. Whether the time expires one is open.
- Goes up on a push, and never back down. A push converts a local one to the cloud's key: its branch becomes that branch's pull request, its folder is dropped, and its time stays. Before a pull request exists, it's held on the branch.
- Takes any set of an image's hunks, and approves their union, so a person can undo a split the differ got wrong, with no special case for one hunk or for all of them. Each stands on its own, so if a later push changes one of them, only that one asks again.
- Approving every hunk of an image records a render's approval on that image's hash, at the commit of the batch being looked at, which is what everything else reads. A hunk approval never counts on its own.

### Storing only what changed

Every batch writes every row. At 10,000 renders a batch and an assumed 100 batches a day, that is 30 million rows a month: about $30 a month in writes and about 1.37 GB a month in storage, which reaches D1's limit of 10 GB per database in about 220 days (rationale). Storing only what changed from a parent batch fixes both, and it adds a parent pointer and read-through complexity to every query. It can wait, along with retention below, until a project gets close.

### Open questions

- **Retention.** Every batch keeps its rows, and nothing deletes one. Deleting needs to keep any batch a golden points at, and `docs/specs/store.md` → Image keys forbids reusing a key, so `render_batches` would need a rule of its own.
