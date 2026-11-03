# RenderBatches — Rationale

> Informative companion to [batches.md](renders.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Render names

**No separate settings.** Nothing produces render settings outside the environment today: the renderer's viewport and scale are in it. A caller with a variant can put it in the opaque story ID, so a column would only add a parameter per row and a second cursor field. No store holds this data yet, so this was the cheap time to drop it, and adding one later would need a migration.

**The environment is on the run, not each row.** With IDs like `container-linux-arm64-<16 hex>` that saves about 40 bytes per row, and it makes a mixed-environment run impossible to store. Decisions keep the environment in their key, since they outlive any run.

**Not interning names.** A table of names with integer keys would make each row much smaller, by estimate rather than measurement. It also costs a second statement per group and a lookup per name. Worth revisiting with [storing only what changed](renders.md#storing-only-what-changed).

## Runs

**A count, not trust.** Batches aren't atomic, so "the caller reached the last line" doesn't prove the rows landed. `finishRun` compares a count taken in the same statement. Reading those rows costs one read each, once per run.

**Resolving images by hash in the statement.** Taking a hash rather than a key costs one read per row, but no caller holds a key, and a render can't name an image that isn't stored. A statement returning fewer rows than it was sent is how a missing image or a finished run shows, with no extra request unless something is wrong.

**A new run after a crash.** Skipping what already landed would need a way to read a recording run back, for a case that only follows a crash. The cost is rendering again, and a crashed run's rows stay, unused.

**What a resend can overwrite.** `decide` and `acceptRun` have no ordering rule, so a statement resent after a lost response could overwrite another writer's change made in between. The adapter resends within seconds, and on one machine there is rarely another writer. A cloud store with several writers has this gap until sync brings an [ordering rule](renders.md#future).

**Accepting a run already accepted.** Accepting a rerun over its own SHA's goldens makes the run its own baseline, so a resend finds nothing removed and would report a wrong count, after success. The statement passes a run that already holds the goldens. A test fails without this.

**A run's facts in columns.** `selfie review` first kept whether a tree was dirty, its baseline, and its play errors in a file beside the exported images. Pruning that file lost them, and with them the rule that a dirty run can't become goldens, so a UI, or anyone else calling `acceptRun`, wasn't bound by it. They became columns while no store held this data, which is why this table could still change: see `docs/specs/store.md` → Open questions for the next time.

**Not yet run on real D1.** The `play_error` column, the three new columns on `runs`, the longest statement of play errors and failures, and `firstWithGoldens` are in the contract suite, and pass on local SQLite through the same `Sql` limits. The run on real D1 wasn't made when they went in, so their fit there is unproven, and the suite's size of about 90 requests is counted from the code rather than measured. A statement of 33 renders with both messages at their 2,000 characters binds about 132 KB, which is the case to watch.

**A filter as a fact.** Whether a removed golden is really gone or only outside the run's filter needs the patterns, so they're kept too. What's unmatched is kept alongside them, since a comparison lists too little to work it out.

## Compare

**Refusing a missing baseline.** Reporting everything as new would look like a first run, and hide a wrong SHA.

**Only differences by default.** A mostly unchanged compare fell from 3 requests and 2.9 MB of responses to 1 request and 56 KB, with 250 differences listed, or about 220 bytes each. Rows read barely moved, from 70,015 to 60,213, since finding differences still reads both sides and the count reads them again. That costs about $0.00006 at D1's listed $0.001 per million rows.

## Decisions

**Keeping no history.** A log of every decision would merge cleanly, but nothing in `selfie review` or the review UI reads one.

**A reappearing image.** A name and hash is exactly what the system spec asks for, and it is what stops a re-approval at push. Its cost is that A → B → A shows the second A as approved, if A was ever explicitly approved. A review could ask again by comparing times, but that needs a decision about what approval means.

## Goldens

**A pointer to a run, not a copy of its rows.** Copying would write 10,000 rows per accepted SHA, and D1 bills per row written. A pointer writes one, and exists whole by construction, so there is no partial set to explain after a crash. What it gives up is goldens with a mix of images from several runs. A baseline must be complete to be a baseline, so nothing reads a partial set. A future sync can bring goldens in as rows of a local run.

**All or nothing per SHA.** A SHA with 3 images unapproved has no goldens yet, and `find-baseline` moves on to the next candidate. Approvals made meanwhile are kept against their hash, so once the last is made, accepting succeeds with nothing to redo.

**A dirty run in the statement.** A caller could always check `dirty` itself, and one that forgot would make goldens that misdescribe their SHA. The check is one more condition in a statement that exists to make such a rule hold.

**A gate here, not in the caller.** The statement is the only place the check and the write can't be separated, and it is what makes "golden" mean "accepted". A first set needs its approvals like any other, which costs one request per 19,200 images.

**Counting removals.** Every image in a filtered render is unchanged, so the image gate alone would accept it and drop every story it missed from that SHA's goldens. A test does exactly this with 500. The count is asked for rather than a list because the run and its baseline already fix which renders are removed.

## Requests

**Measured on real D1, 2026-11**, from one Mac over the REST API at 10,000 renders, with the sizes in the spec. `compareRun` is of a run with 100 changed, 50 failed, 50 new, 50 removed, and 9,800 unchanged:

| Operation | Time | Requests | Rows read | Rows written | Response |
|---|---|---|---|---|---|
| `beginRun` | 105 ms | 1 | 0 | 3 | 360 B |
| `recordRenders` | 748 ms | 1 | 40,205 | 10,000 | 204 KB |
| `finishRun` | 128 ms | 1 | 10,006 | 1 | 555 B |
| `decide` | 560 ms | 1 | 0 | 10,000 | 65 KB |
| `acceptRun`, with no baseline | 117 ms | 1 | 30,006 | 1 | 1.2 KB |
| `compareRun` | 92 ms | 1 | 60,213 | 0 | 56 KB |

D1's docs say a database runs one query at a time, so a batch this size holds up others for as long as it runs. No test measured concurrent load. `acceptRun` against a baseline also reads both sides to count removals, which this run didn't measure.

**Statement size.** A record statement holds 49 renders, limited by the 100 bound parameters, since each needs a story and either a hash or a failure. Its SQL is under 2,000 bytes, so the 100,000 byte limit is far off. `Sql` binds no nulls, so the column a row leaves empty is a literal in the statement.

**Request size.** A 10,000 render run is 205 statements and 1.27 MB with 30 character story IDs, against the store's 2,000 statement batch (`store.rationale.md` → D1 REST adapter). 400 statements is a judgment call inside what was measured. A failure-heavy request grows with the 2,000 character limit, and at its worst, 400 statements of 49 failures at that length, would be about 39 MB. That size was not tested.

**Page size.** Pages of 5,000 rows, at about 290 bytes a row and 1.44 MB a page, returned without trouble. No larger page was tested, and D1's docs state no limit on a response.

**Schema on D1.** `WITHOUT ROWID`, `UPDATE ... FROM`, `WITH ... INSERT`, and `RETURNING` from an upsert all ran on real D1.

## Storing only what changed

**The numbers.** 10,000 rows × 100 runs × 30 days is 30 million rows a month. The 100 runs a day is an assumption, not a measurement.

- **Writes.** D1 lists $1.00 per million rows written, so about $30 a month. It also lists the first 50 million a month as included on the paid plan, so a project this size alone pays nothing until others use up that allowance.
- **Storage.** About 1.37 GB a month assumes about 46 bytes a row. Local SQLite measured 39 bytes a row by file growth with 30 character story IDs, which would be 1.17 GB a month and about 256 days to the limit. D1's own overhead was not measured.
- **The limit.** D1's docs list 10 GB per database on the paid plan and 500 MB on the free plan, as checked 2026-11. On the free plan this rate reaches the limit in about 11 days.

## Decisions

**How two stores agree.** A decision is the only thing beside goldens that two stores can hold differently, since images are named by their hash and a finished run never changes. Latest wins, which needs no schema change, since each row already holds its time, actor, and decision. A tie has to come out the same in either order, so a rejection beats an approval, since that's the mistake that's cheaper to make. The author isn't compared: a decision's author can differ between stores, since the cloud names who pushed it, so comparing it could hand a decision to someone who only re-pushed it. Clocks can differ, which only matters if two people decide on one image within that difference.
