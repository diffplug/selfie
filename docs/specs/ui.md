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
| `ui/src/shared/regions.ts`, exported as `selfie-ui/regions` | Grouping a diff's regions for showing, for the client and the CLI's document |
| `ui/src/server/app.ts`, exported as `selfie-ui/app` | The routes under `/api`, over a `ReviewSource`, on Hono, and `sameOriginWrites` and `pageHeaders`. It re-exports the wire types |
| `ui/src/server/local.ts`, exported as `selfie-ui/local` | Node's serving, and the allowed hosts |
| `ui/src/client/` | The React client, on Primer, built by Vite into `ui/dist/` |
| `cli/src/ui.ts` | `localReviewSource`: a `ReviewSource` over a repository, through the CLI's library |
| `ui/.storybook/`, `ui/src/client/*.stories.tsx`, `ui/src/client/stories/` | Every screen as a story, which Selfie reviews itself by ([Stories](#stories)) |
| `ui/storybook-fixtures/` | Images generated before each Storybook build, at the paths the server answers. Not in Git |

- **Must keep `ui/src/server/app.ts` free of anything specific to a platform**: no Node, no file, no Git. It knows Hono, `selfie-store`'s core, and `ReviewSource`. `cli/test/ui.test.ts` checks what it loads.
- **Must have `selfie-cli` depend on `selfie-ui`, never the reverse** (rationale). `docs/specs/cli.md` → ui owns how it loads it.
- **Must define what crosses into `selfie-cli` once, in `ui/src/shared/api.ts`.** `isDecidable` and `isImageHash` are in `selfie-store`, since the client, the routes, and the CLI all need them at runtime.
- **Must use Primer's components and tokens**, with `ui/src/client/styles.css` for layout only, and pin Primer's versions.
- **Must follow Primer's color mode from the system**, light or dark.
- **Must keep `ui/dist/` out of Git.** `prepare` builds it on `pnpm install`, `pnpm test` in `ui/` builds it, and so does `pnpm build:ui` (rationale).

## ReviewSource

Source of truth: `ReviewSource` in `ui/src/shared/api.ts`.

| Method | Returns |
|---|---|
| `current()` | HEAD, the newest finished run there, whether it has only unfinished ones, and the baseline search if there's no run to open |
| `runView(runId)` | A `RunView` ([Recomputing](#recomputing)) |
| `baseline(runId)` | The baseline search of a run's environment, for a screen saying why it has none |
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
| `GET /api/runs/:id/baseline` | `baseline` |
| `GET /api/runs/:id/unchanged` | `{ rows }` |
| `POST /api/runs/:id/decisions` | `{ decision, snapshots: [{ story, imageHash }] }` |
| `POST /api/runs/:id/accept` | `{ removedSeen? }` |
| `GET /api/images/:hash` | The stored file, with its media type |
| `GET /api/diffs/:current/:golden` | The `PixelDiff` |
| `GET /api/diffs/:current/:golden/image` | The diff PNG |

| Status | `error.code` | When |
|---|---|---|
| 400 | `bad-run-id`, `bad-image-hash`, `bad-request` | The request can't mean anything |
| 403 | `bad-host`, `bad-origin`, `bad-request-kind` | `docs/specs/access.md` → Local review server |
| 404 | `unknown-run`, `unknown-image`, `no-diff-image`, `not-found` | |
| 409 | `stale-decision`, `no-actor`, `run-not-finished`, `no-goldens`, `run-dirty`, `run-has-failures`, `wrong-removed-count` | The request can't apply to the data as it stands |

- **Must refuse an image hash that isn't 64 lowercase hex digits before it reaches the store.**
- **Must give images, diff images, and diff stats `Cache-Control: private, max-age=31536000, immutable`**, since all are addressed by content (`docs/specs/access.md` → Local review server), and every other API answer `no-store`.
- **Must decide on exactly the images a request names, or none:** the library's `decide` refuses with `stale-decision` if any named story and hash isn't a changed or new image of that run, and takes the names exactly, never as patterns (rationale).
- **Must refuse a bulk request no differently from a single one.** Nothing on the server knows "all": the client sends what it showed.
- **Must compare a run at most twice for a decision, and once for anything else, plus once for each if it's shown against branch goldens**, never reading unchanged rows unless a route asks for them.
- **Must pass `removedSeen` as given, and let `accept` judge it**, so a count that moved comes back as `wrong-removed-count`.
- **Must serve any page but `/assets/*` and `/api/*` as the client's one document**, with `no-store`, and a missing asset as 404.

## Recomputing

Source of truth: `localReviewSource` in `cli/src/ui.ts`, `useRun` in `ui/src/client/hooks.ts`.

- **Must answer every action with a `RunView` computed afresh through `summarizeRun` and `checkAccept`, from the comparison made after it, and show only that.** The client holds no verdict of its own.
- **Must read the run once when the window regains focus**, since the CLI or another tab may have decided, and say so if the server can't be reached.
- **Must show what would stop `accept` before anyone asks**, from `checkAccept`, which changes nothing.
- **Must abort a read that a newer read or an action's answer supersedes**, so a slow read can't undo an action.
- **Must keep the objects of rows a new `RunView` didn't change**, by story, hashes, and decision, so only a changed row re-renders.

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

**The run** shows, in order: its commit, run ID, whether its pixels were rendered earlier and by which run, dirty state, baseline, environment, and decision actor; a warning if it was recorded dirty, has no baseline, is shown against branch goldens (`docs/specs/cli.md` → Review), or its SHA can't be a baseline; the counts; blockers; advisories; and the differences.

- **Must group blockers by reason, in words, and offer each as a filter of the list.**
- **Must keep the filter, text and state, in the URL, and nowhere else**, so back, reload, and next and previous all follow it. A row's link takes the filter from the URL on a click, so a keystroke re-renders only the rows it shows or hides, and a link opened in a new tab has no filter.
- **Must list unchanged stories only when asked**, by the `unchanged` filter, which is when they're fetched.

**Bulk decisions:** approve or reject all, or all the current filter shows.

- **Must confirm every bulk decision in a dialog, with the count, how many are changed and new, how many are already decided, how many have an advisory, and which stories.** Focus starts on Cancel.
- **Must hold the rows in the dialog from when it opens, and send those**, so what it listed is what's sent, whatever a filter or a read does meanwhile.

**One snapshot** shows its state and decision, pixel stats, and images.

- **Must always offer the images side by side and stacked.** Stacked, switching layers costs no scroll, and the zoom starts at actual size: the image's width divided by `run.scale`, in CSS pixels, so it's the size the page really was on every display.
- **Must fit an image's width side by side, and scroll all of them as one**, so a tall page's images stay level.
- **Must also offer zoom at 1×, 2×, 4×, and 8×, where 1× is one image pixel to one device pixel** (rationale), following the display's `devicePixelRatio`.
- **Must draw nearest-neighbor only at a whole number of device pixels per image pixel, and smooth anything else**, as with a 2× image on a 1× display or a 1.5× image on a 2× display at actual size, since uneven blocks would look like changes.
- **Must center a change on stacking the images and on every zoom:** the region being looked at if there is one, or else the bounding box if it fits, or else the first changed pixel, since a large box's center may hold no change at all (rationale).
- **Must list a changed snapshot's regions, however few, grouped by `regionMergeDistance`, in reading order, each with its number, kind, how much it holds, and where it is on each side.** One region gets no special case (rationale).
- **Must outline each region on every image, in that image's own coordinates, numbered as in the list, in its kind's color from the diff image**, side by side and stacked, and let the outlines be turned off.
- **Must let someone select any set of regions, from the list, from an outline, or with a key, and keep that only while they stay on the story.** Clicking a stacked region's outline selects it, and side by side only its number does, since clicking an image there stacks it.
- **Must keep the region being looked at still when flipping between images**, since it can be somewhere else in the other one (rationale).
- **Must keep how someone is looking when moving between stories**, and must never show one story's image under another's name while it loads.
- **Must compute diff images, and pixel stats a run's `review.json` no longer holds, on demand, from the store, by hash pair**, so a pruned run reads like any other. A list shows stats only from `review.json`, and one snapshot uses them rather than ask (rationale).
- **Must explain each kind of snapshot:** new has no golden, removed has no current and takes no decision, failed shows its message, and a changed size says so, and shows the images from their top left corners.
- **Must say when a changed snapshot is only moves and spacing, in the list, the pixel stats, and a banner, and that it still needs a decision**, and offer those as a filter of the list, so they can be approved together (rationale).
- **Must say what the diff image's colors mean wherever it has more than one.**
- **Must not offer a decision on what has no image to decide on.**

**Accepting** shows, in plain words, every refusal `accept` would give, and what to do about it.

- **Must say, for a run with `reusedFromRun`, that these pixels were rendered earlier, by which run, with a link to it**, so a person accepting here knows as much as `selfie accept` tells an agent (`docs/specs/cli.md` → Recording only if necessary).
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
| `s`, `f`, `d` | A snapshot | Side by side, stacked then flip, diff |
| `z`, `c` | A snapshot | Next zoom, center on the region being looked at or else the change |
| `n`, `p` | A snapshot | Next and previous region |
| `x` | A snapshot | Select the region being looked at, or the first |
| `u` | A snapshot | Back to the list, with focus on that story |
| `?` | A snapshot | Lists these |

- **Must show each key on screen beside what it does.**
- **Must ignore a key while someone is typing, a dialog is open, or a modifier is held, and ignore a held key's repeats**, so holding `a` can't approve one image after another unseen (rationale). A focused checkbox isn't typing.

## Stories

Source of truth: `ui/src/client/*.stories.tsx`, `ui/src/client/stories/fixtures.ts`.

`pnpm selfie:review` builds them, and reviews them with Selfie.

- **Must have a story for every screen and state this spec lists**, including empty and failed ones, dialogs, and keyboard flows, which are play functions.
- **Must show a screen through its props and fixtures, with no server.** Images come from `ui/storybook-fixtures/`, at the paths the server answers, so a screen doesn't know the difference.
- **Must make fixture images real**, with their real hashes and pixel diffs, from `cli/scripts/generate-storybook-fixtures.ts`, which uses the CLI's own diff, so `selfie-ui` still doesn't depend on `selfie-cli`.
- **Must set on `<html>` and `<body>` what `ui/index.html` sets**, since Primer's themes read it (rationale).

## Accessibility

- **Must never show a state by color alone:** each has a word and an icon.
- **Must label every control, use real buttons and links, and keep focus visible**, with Primer's own focus style or `--focus-outlineColor`. Checked with axe on each screen, at the time of writing (rationale).

## Scale

- **Must not read a blob to show a list.** Row data comes from `compareRun` and `review.json`, and thumbnails use `loading="lazy"` (rationale).
- **Must not read the unchanged stories until asked**, or ask Git why a run has no baseline until a screen shows it.
- **Must not virtualize the list, or put `content-visibility` on its rows** (rationale).

## Future

**Scope: cloud-deploy** is defined in `docs/specs/system.md` → Build order. What it must do first, since the local UI needs none of it:

1. **Move the review rules into platform-free code, and narrow `ReviewSource` to platform facts.** A hosted source needs a branch's commits as one of those facts to offer branch goldens, or it offers none. A Worker can't load `selfie-cli`, which reaches Git, Docker, and the filesystem, and today `summarizeRun`, `checkAccept`, and diffing live there, and `localReviewSource` applies them. `filterStories`, which `summarizeRun` calls, has to move out of `selfie-render` for that. `isDecidable` has moved already.
2. **Make the source a per-request factory, `(context) => ReviewSource`, with a client base path.** A hosted service has many projects and viewers, where `createLocalApp` has one project for its whole life, and a client that always asks at `/api`.
3. **Fit the Worker's budget.** The shared D1 limit is 1,200 requests per 5 minutes. One approve-and-next is 10 requests as measured on the local adapter: 6 for the decision (read the run, compare, write, compare, read whose goldens these are, list the commit's runs), and 4 lookups for the next story's two images and its diff. That's 120 stories per 5 minutes, for every reviewer of every project, down from 15 requests and 80 stories before the comparisons were reduced. What gets it to about 3:
   - no D1 lookup per image, since a content address needs none before reading R2
   - diff stats and diff PNGs stored at review time, not computed in a request, which also moves image decoding and diffing out of a Worker's request
   - answering a decision from the comparison and what the page already knows, and a version check or ETag on focus reads
4. **Serve less to a browser.** Thumbnails of about 2 KB stored at capture, rather than a full PNG for a list row, and each theme's CSS loaded only when used, since the CSS is 370 KB here.

Also its own guard in place of `loopbackHosts`, keeping `sameOriginWrites` and `pageHeaders` (`docs/specs/access.md` → Who can do what), and a way to serve `ui/dist/` from a Worker.

**Scope: annotations** is defined in `docs/specs/system.md` → Build order.

### Not built

- Doing anything with a selection. Approving and rejecting are still on a whole image, until there are decisions on regions (`docs/specs/snapshots.md` → Future).
- Selecting one region out of a group. Lowering `regionMergeDistance` separates them.
- Rendering from the UI. A reviewer runs `selfie review` and looks at the result.
- A way to clear a decision. One can be replaced, and a run can be reviewed again, but `Snapshots.decide` has no way to remove one.
- Finding runs at other commits. `/runs/:id` opens any of them, and `selfie ui <run>` prints that URL, but nothing lists them: `runs` has no index that would serve it without a scan.
- Sorting the list by size of change.
