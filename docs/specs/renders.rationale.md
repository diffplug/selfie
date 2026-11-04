# RenderBatches — Rationale

> Informative companion to [renders.md](renders.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Render names

**No separate settings.** Nothing produces render settings outside the environment today: the renderer's viewport and scale are in it. A caller with a variant can put it in the opaque story ID, so a column would only add a parameter per row and a second cursor field. No store holds this data yet, so this was the cheap time to drop it, and adding one later would need a migration.

**The environment is on the batch, not each row.** It makes a mixed-environment batch impossible to store. Decisions keep the environment in their key, since they outlive any batch.

**Names as integers.** Measured on local SQLite, 2026-11, with 10,000 stories: a render went from 60 bytes to 21, and across 499,800 decisions from 20,000 clicks over 20,000 commits, a decision went from 479 bytes to about 87, with reading those at the newest 1,000 commits going from 54 ms to about 38. Each write costs a statement that gives its names keys, which writes nothing for a name already held, and each read joins them back. Real D1 hasn't run these numbers.

## Render batches

**A count, not trust.** Batches aren't atomic, so "the caller reached the last line" doesn't prove the rows landed. `finishBatch` compares a count taken in the same statement. Reading those rows costs one read each, once per batch.

**Resolving images by hash in the statement.** Taking a hash rather than a key costs one read per row, but no caller holds a key, and a render can't name an image that isn't stored. A statement returning fewer rows than it was sent is how a missing image or a finished batch shows, with no extra request unless something is wrong.

**A new batch after a crash.** Skipping what already landed would need a way to read a recording batch back, for a case that only follows a crash. The cost is rendering again, and a crashed batch's rows stay, unused.

**What a resend can overwrite.** `decide` and `acceptBatch` have no ordering rule, so a statement resent after a lost response could overwrite another writer's change made in between. The adapter resends within seconds, and on one machine there is rarely another writer. A cloud store with several writers has this gap until sync brings an [ordering rule](renders.md#future).

**Accepting a batch already accepted.** Accepting a rerun over its own SHA's goldens makes the batch its own baseline, so a resend finds nothing removed and would report a wrong count, after success. The statement passes a batch that already holds the goldens. A test fails without this.

**A batch's facts in columns.** `selfie review` first kept whether a tree was dirty, its baseline, and its play errors in a file beside the exported images. Pruning that file lost them, and with them the rule that a dirty batch can't become goldens, so a UI, or anyone else calling `acceptBatch`, wasn't bound by it. They became columns while no store held this data, which is why this table could still change: see `docs/specs/store.md` → Open questions for the next time.

**Not yet run on real D1.** The three new columns on `render_batches`, the longest statement of failures, and `firstWithGoldens` are in the contract suite, and pass on local SQLite through the same `Sql` limits. The batch on real D1 wasn't made when they went in, so their fit there is unproven, and the suite's size of about 90 requests is counted from the code rather than measured. A statement of 33 renders with both messages at their 2,000 characters binds about 132 KB, which is the case to watch.

**Windows in columns.** The image's size can't say what window a story laid out in, since a full-page image may be taller or wider than its window, and neither can the environment's ID, which is a hash. On the batch beside `scale`, since it's the same kind of fact. A story's own on its render, empty for nearly every row, so sync and reuse carry it with the row. This costs 2 bytes a row and replaced two tables that didn't sync, and left a cloud batch unable to size a live story.

**A filter as a fact.** Whether an approved story is really gone or only outside the batch's filter needs the patterns, so they're kept too. What's unmatched is kept alongside them, since a comparison lists too little to work it out.

## Compare

**Refusing a missing baseline.** Reporting everything as added would look like a first batch, and hide a wrong SHA.

**Only differences by default.** A mostly unchanged compare fell from 3 requests and 2.9 MB of responses to 1 request and 56 KB, with 250 differences listed, or about 220 bytes each. Rows read barely moved, from 70,015 to 60,213, since finding differences still reads both sides and the count reads them again. That costs about $0.00006 at D1's listed $0.001 per million rows.

## Decisions

**No table of clicks.** Approving 500 stories makes 500 decisions with one verdict, time, actor, and batch, so those could be held once. Measured with the numbers above, that takes a decision from about 87 bytes to about 48, which on that whole history is 20 MB, or about 2 cents a month, for a table, a unique key, a join on every read, and rows left behind when a decision is replaced. A decision's batch stays an ID, since it can name a batch that never came here.

**By commit first.** History is read a commit at a time, so the primary key makes that a range, and the index that remains is the one for finding a decision on an image.

**Refusing a decision on an image that isn't here.** A decision used to hold its image's hash, so it could arrive first. Holding the key means the image must be here, and nothing lost by that: sync sends a batch's images, then its renders, then decisions on those same images.

**Keeping no history.** A log of every decision would merge cleanly, but nothing in `selfie review` or the review UI reads one.

## Approvals

**History, not a promoted set.** Asking someone to accept a batch on a clean default branch made them render again after a merge, to end up with what they'd already approved. Working it out from history asks nothing at a merge, since a batch there finds the approvals its branch brought.

**Up to the batch asking.** A batch looked at again later shouldn't change what it reads as because of work done since, or an earlier batch on a branch would compare with a later commit's approvals.

**Author time as a branch's start.** A branch name can be reused, so its old batches mustn't count forever, and the merge-base can't bound them, since a rebase moves it past the batches it's meant to find. A rebase keeps author times, so the earliest among the branch's own commits holds still. An older commit merged in only widens the window, on the same branch name.

**Leaving out a batch's own approvals.** A story approved on a batch still has to be listed there, approved, or a person going through a review sees rows vanish as they decide, and can't see what they approved.

**Newer than the reference.** This replaces a name and hash holding forever, whose cost was that A → B → A showed the second A as approved. Now it asks, since B was the last thing anyone said was right.

**One parameter however long the history.** `json_each` takes 1,000 commits as one bound parameter, where an `IN` list would take a request per 99.

**No derived table, locally.** Measured on local SQLite at Dormouse's 568 stories, reaching 1,000 commits: reading 11,360 decisions takes about 0.4 s, 113,600 about 1.7 s, and 568,000 about 4 s. Those have every story approved at every commit, which is much worse than a commit that changes a few stories. A compare reads them once, and an approval twice.

## Goldens

**A pointer to a batch, not a copy of its rows.** Copying would write 10,000 rows per accepted SHA, and D1 bills per row written. A pointer writes one, and exists whole by construction, so there is no partial set to explain after a crash. What it gives up is goldens with a mix of images from several batches. A baseline must be complete to be a baseline, so nothing reads a partial set. A future sync can bring goldens in as rows of a local batch.

**All or nothing per SHA.** A SHA with 3 images unapproved has no goldens yet, and a pull's walk moves on to the next candidate. Approvals made meanwhile are kept against their hash, so once the last is made, accepting succeeds with nothing to redo.

**A dirty batch in the statement.** A caller could always check `dirty` itself, and one that forgot would make goldens that misdescribe their SHA. The check is one more condition in a statement that exists to make such a rule hold.

**A gate here, not in the caller.** The statement is the only place the check and the write can't be separated, and it is what makes "golden" mean "accepted". A first set needs its approvals like any other, which costs one request per 19,200 images.

**Counting removals.** Every image in a filtered render is unchanged, so the image gate alone would accept it and drop every story it missed from that SHA's goldens. A test does exactly this with 500. The count is asked for rather than a list because the batch and its baseline already fix which renders are removed.

## Schema

**Foreign keys, before there's data.** Nothing in the store deletes yet, and every write already goes through a path that writes parents first, so these catch only bugs for now. What they're for is retention: once a batch can be deleted, they're what stop one going while something points at it. SQLite can't add a foreign key to an existing table, so waiting would mean rebuilding tables in a migration, where today it's an edit to their `CREATE` statements. Inserting 10,000 renders took 9 ms with checks and 8 ms without, in one local run. A store from before this keeps working, without them. They haven't run on real D1, only on its engine in the Worker tests.

## Requests

**Measured on real D1, 2026-11**, from one Mac over the REST API at 10,000 renders, with the sizes in the spec. `compareBatch` is of a batch with 100 changed, 50 failed, 50 added, 50 removed, and 9,800 unchanged:

| Operation | Time | Requests | Rows read | Rows written | Response |
|---|---|---|---|---|---|
| `beginBatch` | 105 ms | 1 | 0 | 3 | 360 B |
| `recordRenders` | 748 ms | 1 | 40,205 | 10,000 | 204 KB |
| `finishBatch` | 128 ms | 1 | 10,006 | 1 | 555 B |
| `decide` | 560 ms | 1 | 0 | 10,000 | 65 KB |
| `acceptBatch`, with no baseline | 117 ms | 1 | 30,006 | 1 | 1.2 KB |
| `compareBatch` | 92 ms | 1 | 60,213 | 0 | 56 KB |

D1's docs say a database runs one query at a time, so a batch this size holds up others for as long as it runs. No test measured concurrent load. `acceptBatch` against a baseline also reads both sides to count removals, which this batch didn't measure.

**Statement size.** A record statement holds 49 renders, limited by the 100 bound parameters, since each needs a story and either a hash or a failure. Its SQL is under 2,000 bytes, so the 100,000 byte limit is far off. `Sql` binds no nulls, so the column a row leaves empty is a literal in the statement.

**Finding a decision by its image.** A decision's primary key starts with its commit, so a lookup by story and image needs `decisions_by_image`. With no statistics SQLite picks the primary key anyway, by environment alone, and calling that a `SEARCH` hides it from a check for scans. At 100,000 decisions a page of 500 renders took 2,080 ms that way and 0.8 ms with the index named, in one local run, and 0.7 ms at 499,800. `ANALYZE` also fixes the plan, but nothing runs it. Real D1 hasn't run `INDEXED BY`, so its plan there is unproven.

**Request size.** A 10,000 render batch is 205 statements and 1.27 MB with 30 character story IDs, against the store's 2,000 statement batch (`store.rationale.md` → D1 REST adapter). 400 statements is a judgment call inside what was measured. A failure-heavy request grows with the 2,000 character limit, and at its worst, 400 statements of 49 failures at that length, would be about 39 MB. That size was not tested.

**Page size.** Pages of 5,000 rows, at about 290 bytes a row and 1.44 MB a page, returned without trouble. No larger page was tested, and D1's docs state no limit on a response.

**Schema on D1.** `WITHOUT ROWID`, `UPDATE ... FROM`, `WITH ... INSERT`, and `RETURNING` from an upsert all ran on real D1.

## Storing only what changed

**The numbers.** 10,000 rows × 100 batches × 30 days is 30 million rows a month. The 100 batches a day is an assumption, not a measurement.

- **Writes.** D1 lists $1.00 per million rows written, so about $30 a month. It also lists the first 50 million a month as included on the paid plan, so a project this size alone pays nothing until others use up that allowance.
- **Storage.** About 1.37 GB a month assumes about 46 bytes a row. Local SQLite measured 39 bytes a row by file growth with 30 character story IDs, which would be 1.17 GB a month and about 256 days to the limit. D1's own overhead was not measured.
- **The limit.** D1's docs list 10 GB per database on the paid plan and 500 MB on the free plan, as checked 2026-11. On the free plan this rate reaches the limit in about 11 days.

## Decisions

**How two stores agree.** A decision is the only thing beside goldens that two stores can hold differently, since images are named by their hash and a finished batch never changes. Latest wins, which needs no schema change, since each row already holds its time, actor, and decision. A tie has to come out the same in either order, so a rejection beats an approval, since that's the mistake that's cheaper to make. The author isn't compared: a decision's author can differ between stores, since the cloud names who pushed it, so comparing it could hand a decision to someone who only re-pushed it. Clocks can differ, which only matters if two people decide on one image within that difference.
