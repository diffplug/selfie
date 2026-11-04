# UI

> Status: built — the local review UI, served by `selfie ui`. It runs on one person's machine with no login. Deploying it is `cloud-deploy`; see `## Future`.
>
> - See `docs/specs/glossary.md` for batch, render, reference, decision, and environment.
> - Owns the routes, the seam a platform implements, and what each screen must show. `docs/specs/access.md` → Local review server owns who may reach it. `docs/specs/cli.md` → ui owns the command, and → Library the facts it shows. `docs/specs/renders.md` owns what the facts mean.

## Package

Source of truth: `ui/`.

| Path | Holds |
|---|---|
| `ui/src/shared/api.ts` | The JSON on the wire, and `ReviewSource` |
| `ui/src/shared/hunks.ts`, exported as `selfie-ui/hunks` | Grouping a diff's hunks for showing, for the client and the CLI's document |
| `ui/src/shared/notes.ts`, exported as `selfie-ui/notes` | Shared note validation and open-note state (`docs/specs/feedback.md`) |
| `selfie-ui/sync`, `selfie-ui/sync-api` | `docs/specs/sync.md` → Routes |
| `ui/src/server/app.ts`, exported as `selfie-ui/app` | The routes under `/api`, over a `ReviewSource`, on Hono, and `sameOriginWrites` and `pageHeaders`. It re-exports the wire types |
| `ui/src/server/storybook.ts`, exported as `selfie-ui/storybook` | A hosted Storybook's headers and kept built Storybooks, for any platform |
| `ui/src/server/local.ts`, exported as `selfie-ui/local` | Node's serving, the allowed hosts, and hosting a Storybook's directory |
| `ui/src/client/` | The React client, on Primer, built by Vite into `ui/dist/` |
| `cli/src/ui.ts` | `localReviewSource`: a `ReviewSource` over a repository, through the CLI's library |
| `ui/.storybook/`, `ui/src/client/*.stories.tsx`, `ui/src/client/stories/` | Every screen as a story, which Selfie reviews itself by ([Stories](#stories)) |
| `ui/storybook-fixtures/` | Images generated before each build of the Storybook, at the paths the server answers. Not in Git |

- **Must keep `ui/src/server/app.ts` free of anything specific to a platform**: no Node, no file, no Git. It knows Hono, `selfie-store`'s core, and `ReviewSource`. `cli/test/ui-*.test.ts` checks what it loads.
- **Must have `selfie-cli` depend on `selfie-ui`, never the reverse** (rationale). `docs/specs/cli.md` → ui owns how it loads it.
- **Must define what crosses into `selfie-cli` once, in `ui/src/shared/api.ts`.** `isDecidable` and `isImageHash` are in `selfie-store`, since the client, the routes, and the CLI all need them at runtime.
- **Must use Primer's components and tokens**, with `ui/src/client/styles.css` for layout only, and pin Primer's versions. The one exception is the list of every story, which uses Storybook's own icons and their colors ([Screens](#screens)).
- **Must follow Primer's color mode from the system**, light or dark.
- **Must keep `ui/dist/` out of Git.** `prepare` builds it on `pnpm install`, `pnpm test` in `ui/` builds it, and so does `pnpm build:ui` (rationale).

## ReviewSource

Source of truth: `ReviewSource` in `ui/src/shared/api.ts`.

| Method | Returns |
|---|---|
| `current()` | HEAD, the newest finished batch there, and whether it has only unfinished ones |
| `storiesView()` | Every story of the hosted Storybook, each with its newest render at HEAD ([Every story](#screens)) |
| `render(stories)` | Records a batch of those stories from the hosted Storybook, and says which |
| `batchView(batchId)` | A `BatchView` ([Recomputing](#recomputing)) |
| `unchanged(batchId)` | The batch's unchanged rows |
| `decide(batchId, decision, targets)` | The new `BatchView` |
| `feedback()`, `addNote(note)`, `removeNote(id)` | This session's notes (`docs/specs/feedback.md`) |
| `answerNote(id, text, batchId)`, `resolveNote(id)` | This session's notes after a person's answer, or closing one |
| `sendNotes(via)` | The notes after sending every draft, to a waiting agent or to be copied, and the text to paste into an agent |
| `image(hash)` | Stored bytes, or null |
| `diff(current, golden)` | Pixel stats and a PNG, or null if the store lacks either image |

- **Must throw an error with a `code` to mean a status.** `ERROR_STATUS` in `ui/src/server/app.ts` maps them, and any other error stays in the server's log, with a generic message to the page.

## Routes

Source of truth: `ui/src/server/app.ts`; tests in `cli/test/ui-*.test.ts`.

| Route | Does |
|---|---|
| `GET /api/stories` | `storiesView` |
| `GET /api/batches/:id/context` | `batchContext(id)` |
| `POST /api/renders` | `{ stories }`, which `render` records as a batch |
| `GET /api/batches/:id` | `batchView` |
| `GET /api/batches/:id/unchanged` | `{ rows }` |
| `POST /api/batches/:id/decisions` | `{ decision, renders: [{ story, imageHash }] }` |
| `GET /api/feedback` | `feedback` |
| `POST /api/notes` | `{ story, batchId, imageHash, box, text }` |
| `DELETE /api/notes/:id` | `removeNote` |
| `POST /api/notes/:id/answers` | `{ text, batchId }` |
| `POST /api/notes/:id/resolve` | `resolveNote` |
| `POST /api/notes/send` | `{ via }`, where `via` is `agent` or `copy` |
| `GET /api/images/:hash` | The stored file, with its media type |
| `GET /api/diffs/:current/:golden` | The `PixelDiff` |
| `GET /api/diffs/:current/:golden/image` | The diff PNG |

| Status | `error.code` | When |
|---|---|---|
| 400 | `bad-batch-id`, `bad-image-hash`, `bad-request` | The request can't mean anything |
| 403 | `bad-host`, `bad-origin`, `bad-request-kind` | `docs/specs/access.md` → Local review server |
| 404 | `unknown-batch`, `unknown-image`, `no-diff-image`, `unknown-story`, `not-found` | |
| 409 | `render-busy`, `render-failed`, `no-agent-waiting`, `stale-decision`, `no-actor`, `batch-not-finished` | The request can't apply to the data as it stands |

On a hosted Storybook's own origin (`docs/specs/access.md` → Local review server), `selfie-ui/storybook` serves each kept built Storybook's files at `/built-storybooks/<hash>/`, and locally the directory as it stands is at `/`.

- **Must give a kept built Storybook's files `Cache-Control: private, max-age=31536000, immutable`**, since a kept built Storybook never changes, and the directory as it stands `no-store`, since a rebuild does.
- **Must refuse an image hash that isn't 64 lowercase hex digits before it reaches the store.**
- **Must give images, diff images, and diff stats `Cache-Control: private, max-age=31536000, immutable`**, since all are addressed by content (`docs/specs/access.md` → Local review server), and every other API answer `no-store`.
- **Must decide on exactly the images a request names, or none:** the library's `decide` refuses with `stale-decision` if any named story and hash isn't a changed or added image of that batch, or a null hash a removed story of it, and takes the names exactly, never as patterns (rationale).
- **Must refuse a bulk request no differently from a single one.** Nothing on the server knows "all": the client sends what it showed.
- **Must compare a batch at most twice for a decision, and once for anything else**, never reading unchanged rows unless a route asks for them.
- **Must serve any page but `/assets/*` and `/api/*` as the client's one document**, with `no-store`, and a missing asset as 404.

## Recomputing

Source of truth: `localReviewSource` in `cli/src/ui.ts`, `useBatch` in `ui/src/client/hooks.ts`.

- **Must answer every action with a `BatchView` computed afresh through `summarizeBatch`, from the comparison made after it, and show only that.** The client holds no verdict of its own.
- **Must read the batch once when the window regains focus**, since the CLI or another tab may have decided, and say so if the server can't be reached.
- **Must abort a read that a newer read or an action's answer supersedes**, so a slow read can't undo an action.
- **Must keep the objects of rows a new `BatchView` didn't change**, by story, hashes, and decision, so only a changed row re-renders.

## Which batch

- **Must link [every story](#screens) to the newest finished batch at HEAD in the project's environment, as the batch to review.** A batch still recording, or crashed, is listed on its commit's other batches and can't be opened (`docs/specs/renders.md` → Crashes and retries).
- **Must say when a newer batch exists at the viewed batch's commit, on a batch's own screens.** On [every story](#screens), an older batch is what's newest for that story.

## Screens

Source of truth: `ui/src/client/`.

| Path | Screen |
|---|---|
| `/` | Every story, and where this commit stands |
| `/stories/:story` | One story, whichever batch its newest render is from |
| `/batches/:id` | The batch |
| `/batches/:id/stories/:story` | One render, in the filter from the query |

**The top bar** says what a page is looking at: on every story, the built Storybook, its commit and branch, and whether it's clean; on a batch's pages, the diff, between the batch's commit and what it's compared with, and how that relates to the merge base with the default branch.

**A batch's pages** have the same list at their left, of what differs, which is what's changed, added, removed, or failed, narrowed by what Show says, and showing what's unchanged only if that's what Show asks for, or if it has an advisory. Next and previous go down that list, as far as it's narrowed. The list is where a batch's stories are: there's no table of them on the right.

- **Must say more of each story as the list is dragged wider:** its state and decision, then its pixels and advisories on a batch's pages, or when it was rendered on every story.

- **Must say a story is renamed if it's added and a removed story's reference is its very image**, one to one, and the closest names first where several share an image (rationale). The list has it once, under its new name. This is only to look at: to decisions they're still one added and one removed.

**The batch** shows, in order: its commit, batch ID, whether its pixels were rendered earlier and by which batch, dirty state, environment, and decision actor; a warning if it was recorded dirty; the counts; blockers; advisories; and the differences.

- **Must group blockers by reason, in words, and offer each as a filter of the list.**
- **Must keep the filter, text and state, in the URL, and nowhere else**, so back, reload, and next and previous all follow it.
- **Must list unchanged stories only when asked**, by the `unchanged` filter, which is when they're fetched.

**Bulk decisions:** approve or reject all, or all the current filter shows.

- **Must confirm every bulk decision in a dialog, with the count, how many are changed and added, how many are already decided, how many have an advisory, and which stories.** Focus starts on Cancel.
- **Must hold the rows in the dialog from when it opens, and send those**, so what it listed is what's sent, whatever a filter or a read does meanwhile.

**One render** shows its state and decision, pixel stats, and images.

- **Must always offer the images side by side and stacked.** Stacked, switching layers costs no scroll, and the zoom starts at actual size: the image's width divided by `batch.scale`, in CSS pixels, so it's the size the page really was on every display.
- **Must fit an image's width side by side, and scroll all of them as one**, so a tall page's images stay level.
- **Must also offer zoom at 1×, 2×, 4×, and 8×, where 1× is one image pixel to one device pixel** (rationale), following the display's `devicePixelRatio`.
- **Must draw nearest-neighbor only at a whole number of device pixels per image pixel, and smooth anything else**, as with a 2× image on a 1× display or a 1.5× image on a 2× display at actual size, since uneven blocks would look like changes.
- **Must center a change on stacking the images and on every zoom:** the hunk being looked at if there is one, or else the bounding box if it fits, or else the first changed pixel, since a large box's center may hold no change at all (rationale).
- **Must list a changed render's hunks, however few, grouped by `hunkMergeDistance`, in reading order, each with its number, kind, how much it holds, and where it is on each side.** One hunk gets no special case (rationale).
- **Must outline each hunk on every image, in that image's own coordinates, numbered as in the list, in its kind's color from the diff image**, side by side and stacked, and let the outlines be turned off.
- **Must let someone select any set of hunks, from the list, from an outline, or with a key, and keep that only while they stay on the story.** Clicking a stacked hunk's outline selects it, and side by side only its number does, since clicking an image there stacks it.
- **Must keep the hunk being looked at still when flipping between images**, since it can be somewhere else in the other one (rationale).
- **Must link a render to its story in the very built Storybook that rendered its batch, if that's kept, or else the directory `selfie ui` hosts, and then say it may not match** (`BatchView.storybook`). A removed story has no link.
- **Must offer the live stories, closed and loading nothing until opened, and stay open or closed from story to story**: the kept built Storybook of the batch behind its reference, beside the batch's own, in frames (`docs/specs/access.md` → Local review server), at the size its environment renders at and scaled to fit, or else saying that size wasn't recorded, each saying why if it has none (rationale).
- **Must give a live story the keyboard only when it's clicked in**, taking focus back from one that focuses itself as it loads, so this page's keys keep working (rationale).
- **Must leave the browser's history alone when moving a live story along**, so Back leaves the screen as it does anywhere else (rationale).
- **Must keep how someone is looking when moving between stories**, and must never show one story's image under another's name while it loads.
- **Must compute diff images, and pixel stats a batch's `review.json` no longer holds, on demand, from the store, by hash pair**, so a pruned batch reads like any other. A list shows stats only from `review.json`, and one render uses them rather than ask (rationale).
- **Must explain each kind of render:** added has no reference, removed has no current and takes a decision on the story being gone, failed shows its message, and a changed size says so, and shows the images from their top left corners.
- **Must say when a changed render is only moves and spacing, in the list, the pixel stats, and a banner, and that it still needs a decision**, and offer those as a filter of the list, so they can be approved together (rationale).
- **Must say what the diff image's colors mean wherever it has more than one.**
- **Must not offer a decision on what has no image to decide on.**

**Every story** is the hosted Storybook's stories, nested and ordered as its own sidebar does them, and each with its newest render from the finished batches at HEAD in the project's environment, so several partial batches read as one (rationale). A story's page is that render's batch's, as it would be from that batch's own review.

- **Must say where this commit stands, in order:** the commit and branch; the built Storybook, how many stories it has, and whether it's from a clean checkout; and how many stories have a render (rationale). What's missing says what to do, the page moves on by itself as it's done, and with no renders it offers to render the first story, or all of them, opening that story's page after the first.
- **Must call a built Storybook clean only if nothing is uncommitted and it was built since HEAD last moved**, which is the most Selfie can know of a built Storybook it may not have made (rationale). Otherwise it says which, or both, and may still render.
- **Must say, before rendering from uncommitted changes, what they are, that a render is marked so, and when the built Storybook itself is one of those files.**
- **Must keep the list beside `/` and each `/stories/:story`, on the left, as Storybook's sidebar is** (rationale), with what `/` says, or that story, on the right. A filter stays in the query from page to page, and may be cleared in one click.
- **Must nest by a story's title, keep the built Storybook's order, and use its names**: a top-level section, then a component, then each story, with Storybook's own icons and colors, so a person finds what they know from it (rationale). Only the sections start open. Moving to a story opens the way to it, and a filter opens everything.
- **Must mark each story in the list with its state, in words for a screen reader and on hover, and with any caveat**, and give a story's decision and when it was rendered on its page.
- **Must list a story nothing has rendered, show it running, and offer to render it**, since it's still a real story to look at. A note is written on an image, so starting one renders the story first, and then opens the note box. With no way to render here, it says what command does.
- **Must offer to render again whatever story is on screen, and every story with no render or one known to be from another built Storybook, as Render the rest**, which is how a change fans out to the rest of a Storybook, **and always to render all of them**. Asking for every story records a whole batch, not a filtered one, which can become goldens (rationale).
- **Must render only from the hosted Storybook as it stands, and one at a time**, refusing a second with `render-busy`. It never builds, since a page must not be able to run a shell.
- **Must never read a story a filtered batch left out as removed**, through `newestRenders` in `selfie-store`. It takes that story from an older batch, or else lists it as not rendered.
- **Must say when a render is from uncommitted changes, or known to be from another built Storybook than the one hosted**, since a render is whichever is newest, not whichever is reliable.
- **Must leave out a story the hosted built Storybook no longer has**, and with no built Storybook at all, list only what's been rendered, and say so.
- **Must move next and previous through every story**, not through that story's batch. Decisions go to the batch that rendered the image.

**Notes** are in `docs/specs/feedback.md`, with what they add to these screens.

**Empty and failed:** an unfinished batch, an unknown batch, an unknown page, nothing matching a filter, nothing differing, and the server gone each have their own words and a way on.

## Keyboard

Source of truth: `useHotkeys` in `ui/src/client/hooks.ts`.

| Key | Where | Does |
|---|---|---|
| `j`, `k` | The batch, a render | Next and previous, in the current filter |
| `/` | The batch | Search |
| `a`, `r` | A render | Approve or reject, then go to the next |
| `s`, `f`, `d` | A render | Side by side, stacked then flip, diff |
| `z`, `c` | A render | Next zoom, center on the hunk being looked at or else the change |
| `l` | A render | Open or close the live stories |
| `m` | A render | Write a note |
| `c`, `m` | A story with no render | Render it, or render it to write a note on it |
| `w` | A render | Show the image a note was written on, or go back |
| `n`, `p` | A render | Next and previous hunk |
| `x` | A render | Select the hunk being looked at, or the first |
| `u` | A render | Back to the list, with focus on that story |
| `?` | A render | Lists these |

- **Must show each key on screen beside what it does.**
- **Must ignore a key while someone is typing, a dialog is open, or a modifier is held, and ignore a held key's repeats**, so holding `a` can't approve one image after another unseen (rationale). A focused checkbox isn't typing.

## Stories

Source of truth: `ui/src/client/*.stories.tsx`, `ui/src/client/stories/`.

`pnpm selfie:review` builds them, and reviews them with Selfie.

- **Must have a story for every screen and state this spec lists**, including empty and failed ones, dialogs, and keyboard flows, which are play functions.
- **Must show a page in the layout the app does, with its tree and top bar**, so what's reviewed is what ships.
- **Must list pages in the order someone moves through them, then the parts they're made of**, through `storySort` in `ui/.storybook/preview.tsx`.
- **Must show a screen through its props and fixtures, with no server.** Images come from `ui/storybook-fixtures/`, at the paths the server answers, so a screen doesn't know the difference.
- **Must make fixture images real**, with their real hashes and pixel diffs, from `cli/scripts/generate-storybook-fixtures.ts`, which uses the CLI's own diff, so `selfie-ui` still doesn't depend on `selfie-cli`.
- **Must set on `<html>` and `<body>` what `ui/index.html` sets**, since Primer's themes read it (rationale).

## Accessibility

- **Must never show a state by color alone:** each has a word and an icon.
- **Must label every control, use real buttons and links, and keep focus visible**, with Primer's own focus style or `--focus-outlineColor`. Checked with axe on each screen, at the time of writing (rationale).

## Scale

- **Must not read a blob to show a list.** Row data comes from `compareBatch` and `review.json` (rationale).
- **Must not read the unchanged stories until asked.**
- **Must not virtualize the list, or put `content-visibility` on its rows** (rationale).

## Future

**Scope: cloud-deploy** is defined in `docs/specs/system.md` → Build order. What it must do first, since the local UI needs none of it:

1. **Move the review rules into platform-free code, and narrow `ReviewSource` to platform facts.** `storiesView` is the newest such rule that needs moving, beyond `newestRenders` itself. `render` is for a source with something to render with, so a hosted one says `canRender: false`. A hosted source needs a branch's commits as one of those facts to offer branch goldens, or it offers none. A Worker can't load `selfie-cli`, which reaches Git, Docker, and the filesystem, and today `summarizeBatch`, `checkAccept`, and diffing live there, and `localReviewSource` applies them. `filterStories`, which `summarizeBatch` calls, has to move out of `selfie-render` for that. `isDecidable` has moved already.
2. **Make the source a per-request factory, `(context) => ReviewSource`, with a client base path.** A hosted service has many projects and viewers, where `createLocalApp` has one project for its whole life, and a client that always asks at `/api`.
3. **Fit the Worker's budget.** The shared D1 limit is 1,200 requests per 5 minutes. One approve-and-next is 10 requests as measured on the local adapter: 6 for the decision (read the batch, compare, write, compare, read whose goldens these are, list the commit's batches), and 4 lookups for the next story's two images and its diff. That's 120 stories per 5 minutes, for every reviewer of every project, down from 15 requests and 80 stories before the comparisons were reduced. What gets it to about 3:
   - no D1 lookup per image, since a content address needs none before reading R2
   - diff stats and diff PNGs stored at review time, not computed in a request, which also moves image decoding and diffing out of a Worker's request
   - answering a decision from the comparison and what the page already knows, and a version check or ETag on focus reads
4. **Serve less to a browser.** Each theme's CSS loaded only when used, since the CSS is 370 KB here.

Also its own guard in place of `loopbackHosts`, keeping `sameOriginWrites` and `pageHeaders` (`docs/specs/access.md` → Who can do what), and a way to serve `ui/dist/` from a Worker.

### Not built

- Approving or rejecting a selection. Those are still on a whole image, until there are decisions on hunks (`docs/specs/renders.md` → Future). A note can be on one.
- Selecting one hunk out of a group. Lowering `hunkMergeDistance` separates them.
- A way to clear a decision. One can be replaced, and a batch can be reviewed again, but `RenderBatches.decide` has no way to remove one.
- Finding batches at other commits. `/batches/:id` opens any of them, and `selfie ui <batch>` prints that URL, but nothing lists them: `render_batches` has no index that would serve it without a scan.
- Keeping how someone's looking at the images when the next story's render is from another batch, since each batch's page is its own, and it reads that batch again. The live stories do stay as they were.
- Sorting the list by size of change.
- A hosted Storybook in the cloud (**Scope: cloud-deploy**), where its origin needs the same separation, and a built Storybook needs uploading.
