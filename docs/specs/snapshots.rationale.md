# Snapshots — Rationale

> Informative companion to [snapshots.md](snapshots.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Snapshot names

**Three columns, not one joined string.** Story IDs can hold `/` and anything else a build gives them, so a joined name needs an encoding that every store must then agree on. Columns can't be ambiguous.

**The environment is on the run, not each row.** With IDs like `container-linux-arm64-<16 hex>` that saves about 40 bytes per row, and it makes a mixed-environment run impossible to store. Decisions keep the environment in their key, since they outlive any run.

**Not interning names.** A table of names with integer keys would make each row about 2.7× smaller, by estimate rather than measurement, at 30 character story IDs. It also costs a second statement per group and a lookup per name. Worth revisiting with [retention](snapshots.md#open-questions), and a migration then would be the first real test of that open question.

## Runs

**A count, not trust.** Batches aren't atomic, so "the caller reached the last line" doesn't prove the rows landed. `finishRun` compares a count taken in the same statement. Reading those rows costs one read each, once per run.

**Resolving images by hash in the statement.** Taking a hash rather than a key costs one read per row, but no caller holds a key, and a snapshot can't name an image that isn't stored. A statement returning fewer rows than it was sent is how a missing image or a finished run shows, with no extra request unless something is wrong.

## Compare

**Refusing a missing baseline.** Reporting everything as new would look like a first run, and hide a wrong SHA.

## Decisions

**Why latest wins, by a total order.** Upserting only when `(decided_at, decision, actor)` is greater is what makes the statement commutative and idempotent: it is a last-writer-wins register, so a future sync can run this same statement in any order with no conflict rule. The cost is trusting clocks: a machine whose clock runs behind can lose to an older decision. No test has run with real clock skew.

**Rejection wins a tie**, only because `rejected` sorts after `approved`. The safer of the two.

**Keeping no history.** A log of every decision would also merge cleanly, but nothing in `selfie review` or the review UI reads one, and the latest needs a subquery. Access's audit needs, if any, aren't specified yet.

**A reappearing image.** A name and hash is exactly what the system spec asks for, and it is what stops a re-approval at push. Its cost is that A → B → A shows the second A as approved, if A was ever explicitly approved. A review could ask again by comparing times, but that needs a decision about what approval means.

## Goldens

**A pointer to a run, not a copy of its rows.** Copying would write 10,000 rows per accepted SHA, and D1 bills per row written. A pointer writes one, and exists whole by construction, so there is no partial set to explain after a crash. What it gives up is goldens with a mix of images from several runs. A baseline must be complete to be a baseline, so nothing reads a partial set. A future sync can bring goldens in as rows of a local run.

**All or nothing per SHA.** A SHA with 3 images unapproved has no goldens yet, and `find-baseline` moves on to the next candidate. Approvals made meanwhile are kept against their hash, so once the last is made, accepting succeeds with nothing to redo.

**A gate here, not in the caller.** The statement is the only place the check and the write can't be separated, and it is what makes "golden" mean "accepted". A first set needs its approvals like any other, which costs one request per 12,800 images.

**The `>=` in the acceptance's conflict clause.** So that an older acceptance sent again can't overwrite a newer one, and the same statement sent again still returns its row and reports success.

## Requests

**Measured on real D1, 2026-11**, from one Mac over the REST API at 10,000 snapshots, with the sizes in the spec:

| Operation | Time | Requests | Rows read | Rows written |
|---|---|---|---|---|
| `beginRun` | 101 ms | 1 | 0 | 3 |
| `recordSnapshots` | 1,027 ms | 1 | 40,304 | 10,000 |
| `finishRun` | 96 ms | 1 | 10,006 | 1 |
| `decide` | 665 ms | 1 | 0 | 10,000 |
| `acceptRun` | 137 ms | 1 | 30,005 | 1 |
| `compareRun` | 478 ms | 3 | 70,015 | 0 |

Row counts were the same in an earlier run, where `recordSnapshots` took 536 ms and `decide` 455 ms.

So about 150,000 rows read per recorded, reviewed, and accepted run, or about 15 per snapshot. D1's docs say a database runs one query at a time, so a batch this size holds up others for as long as it runs. No test measured concurrent load.

**The same on local SQLite**, 10,000 snapshots, on one Mac: `recordSnapshots` about 60 ms, `decide` about 45 ms, `acceptRun` about 6 ms, and `compareRun` about 22 ms.

**Request size.** The 304 statement request above carries 1.26 MB with 30 character story IDs, against the store's 2,000 statement batch (`store.rationale.md` → D1 REST adapter). 400 is a judgment call inside what was measured. A failure-heavy request grows with the 2,000 character limit, and at its worst, 400 statements of 33 failures at that length, would be about 26 MB. That size was not tested.

**Page size.** Two pages of 5,000 rows, at about 290 bytes a row and 1.44 MB a page, returned without trouble. No larger page was tested, and D1's docs state no limit on a response.

**Schema on D1.** `WITHOUT ROWID`, `UPDATE ... FROM`, row-value comparison, `WITH ... INSERT`, and `RETURNING` from an upsert all ran on real D1 in that run.
