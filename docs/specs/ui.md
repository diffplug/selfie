# UI

> Status: built — the local review UI, served by `selfie ui`. It runs on one person's machine with no login. Deploying it is `cloud-deploy`; see `## Future`.
>
> - See `docs/specs/glossary.md` for run, snapshot, golden, baseline, decision, and environment.
> - Owns the routes, the seam a platform implements, and what each screen must show. `docs/specs/access.md` → Local review server owns who may reach it. `docs/specs/cli.md` → ui owns the command, and → Library the facts it shows. `docs/specs/snapshots.md` owns what the facts mean.

## Package

Source of truth: `ui/`.

| Path | Holds |
|---|---|
| `ui/src/shared/api.ts` | The JSON on the wire, and `ReviewSource` |
| `ui/src/server/app.ts` | The routes under `/api`, over a `ReviewSource`, on Hono |
| `ui/src/server/local.ts` | Node's serving, and the local guard |
| `ui/src/client/` | The React client, on Primer, built by Vite into `ui/dist/` |
| `cli/src/ui.ts` | `localReviewSource`: a `ReviewSource` over a repository, through the CLI's library |

- **Must keep `ui/src/server/app.ts` free of anything specific to a platform**: no Node, no file, no Git. It knows Hono and `ReviewSource`, and that's what a Worker will reuse (`docs/specs/system.md` → Local review).
- **Must have `selfie-cli` depend on `selfie-ui`, never the reverse** (rationale).
- **Must use Primer's components and tokens**, with `ui/src/client/styles.css` for layout only, and pin Primer's versions.
- **Must follow Primer's color mode from the system**, light or dark.
- **Must keep `ui/dist/` out of Git.** `pnpm test` in `ui/` builds it, and so does `pnpm build:ui` (rationale).

## ReviewSource

Source of truth: `ReviewSource` in `ui/src/shared/api.ts`.

| Method | Returns |
|---|---|
| `current()` | HEAD, the environment, the newest finished run there, every run there, and the baseline search |
| `runView(runId)` | A `RunView` ([Recomputing](#recomputing)) |
| `unchanged(runId)` | The run's unchanged rows |
| `decide(runId, decision, targets)` | The new `RunView` |
| `accept(runId, removedSeen)` | `accepted`, `refusals`, and the new `RunView` |
| `image(hash)` | Stored bytes, or null |
| `diff(current, golden)` | Pixel stats and a PNG, or null if the store lacks either image |

- **Must throw an error with a `code` to mean a status.** `ERROR_STATUS` in `ui/src/server/app.ts` maps them, and any other error stays in the server's log, with a generic message to the page.

## Routes

Source of truth: `ui/src/server/app.ts`; tests in `cli/test/ui.test.ts`.

| Route | Does |
|---|---|
| `GET /api/current` | `current()` |
| `GET /api/runs/:id` | `runView` |
| `GET /api/runs/:id/unchanged` | `{ rows }` |
| `POST /api/runs/:id/decisions` | `{ decision, snapshots: [{ story, imageHash }] }` |
| `POST /api/runs/:id/accept` | `{ removedSeen? }` |
| `GET /api/images/:hash` | The stored PNG |
| `GET /api/diffs/:current/:golden` | `{ diff, hasImage }` |
| `GET /api/diffs/:current/:golden/image` | The diff PNG |

| Status | `error.code` | When |
|---|---|---|
| 400 | `bad-run-id`, `bad-image-hash`, `bad-request` | The request can't mean anything |
| 403 | `bad-host`, `bad-origin`, `bad-request-kind` | `docs/specs/access.md` → Local review server |
| 404 | `unknown-run`, `unknown-image`, `no-diff-image`, `not-found` | |
| 409 | `stale-decision`, `no-actor`, `run-not-finished`, `no-goldens`, `run-dirty`, `run-has-failures`, `wrong-removed-count` | The request can't apply to the data as it stands |

- **Must refuse an image hash that isn't 64 lowercase hex digits before it reaches the store.**
- **Must give images and diff images `Cache-Control: private, max-age=31536000, immutable`**, since they're addressed by content (`docs/specs/access.md` → Local review server), and every other API answer `no-store`.
- **Must decide on exactly the images a request names, or none:** `decide` refuses with `stale-decision` if any named story and hash isn't a changed or new image of that run, and passes IDs to the library exactly, never as patterns (rationale).
- **Must refuse a bulk request no differently from a single one.** Nothing on the server knows "all": the client sends what it showed.
- **Must pass `removedSeen` as given, and let `accept` judge it**, so a count that moved comes back as `wrong-removed-count`.
- **Must serve any page but `/assets/*` and `/api/*` as the client's one document**, with `no-store`, and a missing asset as 404.

## Recomputing

Source of truth: `localReviewSource` in `cli/src/ui.ts`, `useRun` in `ui/src/client/hooks.ts`.

- **Must answer every action with a `RunView` computed afresh through `summarizeRun` and `checkAccept`, and show only that.** The client holds no verdict of its own.
- **Must read the run again when the page regains focus**, since the CLI or another tab may have decided, and say so if the server can't be reached.
- **Must show what would stop `accept` before anyone asks**, from `checkAccept`, which changes nothing.
- **Must discard an answer to a read if a newer request has been sent**, so a slow read can't undo an action.

## Which run

- **Must open `/` at the newest finished run at HEAD in the project's environment.** A run still recording, or crashed, is listed and can't be opened (`docs/specs/snapshots.md` → Crashes and retries).
- **Must say when a newer run exists at the viewed run's commit.**

## Screens

Source of truth: `ui/src/client/`.

| Path | Screen |
|---|---|
| `/` | Goes to the newest run, or says why there's none |
| `/runs/:id` | The run |
| `/runs/:id/stories/:story` | One snapshot, in the filter from the query |
| `/runs/:id/accept` | Accepting |

**The run** shows, in order: its commit, run ID, dirty state, baseline, environment, and decision actor; a warning if it was recorded dirty, has no baseline, or its SHA can't be a baseline; the counts; blockers; advisories; and the differences.

- **Must group blockers by reason, in words, and offer each as a filter of the list.**
- **Must keep the filter, text and state, in the URL**, so back, reload, and next and previous all follow it.
- **Must list unchanged stories only when asked**, by the `unchanged` filter, which is when they're fetched.

**Bulk decisions:** approve or reject all, or all the current filter shows.

- **Must confirm every bulk decision in a dialog, with the count, how many are changed and new, how many are already decided, how many have an advisory, and which stories.** Focus starts on Cancel.
- **Must send exactly the rows the dialog listed.**

**One snapshot** shows its state and decision, pixel stats, and images.

- **Must always offer the images side by side and at actual pixels.** At actual pixels, the layers stay stacked, so switching costs no scroll, with zoom at 1×, 2×, 4×, and 8×, nearest-neighbor, where 1× is one image pixel to one CSS pixel.
- **Must center a change on entering actual pixels and on every zoom:** the bounding box if it fits, or else the first changed pixel, since a large box's center may hold no change at all (rationale). A box too small to find is outlined, and the outline can be turned off.
- **Must keep how someone is looking when moving between stories**, and must never show one story's image under another's name while it loads.
- **Must compute pixel stats and diff images on demand, from the store, by hash pair, whatever is on disk**, so a pruned run reads like any other. List rows show the stats from `review.json` if it's there, and nothing if not.
- **Must explain each kind of snapshot:** new has no golden, removed has no current and takes no decision, failed shows its message, and a changed size shows both images from their top left corners, with no diff image.
- **Must not offer a decision on what has no image to decide on.**

**Accepting** shows, in plain words, every refusal `accept` would give, and what to do about it.

- **Must list every golden accepting would drop, say how many are only outside the run's filter, and require a checkbox before accepting any.** It sends the count it listed, as `removedSeen`.
- **Must say when another run is the commit's goldens, that this one would replace them.**
- **Must show when a run is accepted**, and never offer it again.

**Empty and failed:** no commits, no runs at HEAD, an unfinished run, an unknown run, an unknown page, nothing matching a filter, nothing differing, and the server gone each have their own words and a way on.

## Keyboard

Source of truth: `useHotkeys` in `ui/src/client/hooks.ts`.

| Key | Where | Does |
|---|---|---|
| `j`, `k` | The run, a snapshot | Next and previous, in the current filter |
| `/` | The run | Search |
| `a`, `r` | A snapshot | Approve or reject, then go to the next |
| `s`, `f`, `d` | A snapshot | Side by side, actual pixels then flip, diff |
| `z`, `c` | A snapshot | Next zoom, center on the change |
| `u` | A snapshot | Back to the list, with focus on that story |
| `?` | A snapshot | Lists these |

- **Must show each key on screen beside what it does.**
- **Must ignore a key while someone is typing, a dialog is open, or a modifier is held, and ignore a held key's repeats**, so holding `a` can't approve one image after another unseen (rationale).

## Accessibility

- **Must never show a state by color alone:** each has a word and an icon.
- **Must label every control, use real buttons and links, and keep focus visible**, with Primer's own focus style or `--focus-outlineColor`. Checked with axe on each screen, at the time of writing (rationale).

## Scale

- **Must not read a blob to show a list.** Row data comes from `compareRun` and `review.json`, and thumbnails use `loading="lazy"` (rationale).
- **Must not read the unchanged stories until asked.**

## Future

**Scope: cloud-deploy** is defined in `docs/specs/system.md` → Build order. For this package it needs a `ReviewSource` over D1 and R2, its own guard in place of `localGuard` (`docs/specs/access.md` → Who can do what), and a way to serve `ui/dist/` from a Worker. Diffs are computed per request here, so it also needs somewhere for that work to live: image decoding and diffing are in `cli/`.

**Scope: annotations** is defined in `docs/specs/system.md` → Build order.

### Not built

- Rendering from the UI. A reviewer runs `selfie review` and looks at the result.
- A way to clear a decision. One can be replaced, and a run can be reviewed again, but `Snapshots.decide` has no way to remove one.
- Finding runs at other commits. `/runs/:id` opens any of them, and `selfie ui <run>` prints that URL, but nothing lists them: `runs` has no index that would serve it without a scan.
- An unstable story's second render, which is only in the review's own output and never stored.
- Sorting the list by size of change.
