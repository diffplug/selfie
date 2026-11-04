# UI rationale

Evidence and reasoning for `docs/specs/ui.md`, keyed by its headings.

## Package

- **Why the CLI depends on the UI.** `selfie ui` has to start the server, so `selfie-cli` needs `selfie-ui`. The Hono app must not import `selfie-cli`, whose library reaches Git, Docker, and the filesystem, and which a Worker can't load. So the app states what it needs as `ReviewSource`, in its own package, and `cli/src/ui.ts` implements it. TypeScript checks that the library's results fit the wire types at that one file.
- **Why the library's types come from the UI.** `selfie-cli` already depends on `selfie-ui`, so `import type` from it adds no cycle and loads nothing, and the types then have one definition. A second copy would only have been checked at `cli/src/ui.ts`.
- **Why `isDecidable` and `isImageHash` are in the store.** The client and the routes can't import `selfie-cli`, and a value from `selfie-ui` would load Hono into `selfie review`. The store's core is platform-free, and tree-shaking keeps the rest of it out of the client's bundle, which shrank slightly when this moved.
- **Why `dist/` is built by `prepare`, and by `pnpm test`.** `vite build` takes about 0.2 s here, against about 0.9 s for the package's typecheck, so it slows neither an install nor a test run noticeably, and a fresh checkout works. Building inside `selfie ui` would need Vite at runtime, and the `ui-not-built` error still covers an install with scripts turned off.
- **Why the protections are in `app.ts`.** A login-protected Worker replaces the allowed hosts, and mustn't lose same-origin writes or the page's headers by replacing a single guard along with them.
- **Why `hono/secure-headers`.** It can say the exact policy, which `cli/test/ui-*.test.ts` checks string for string. Its other defaults (`Cross-Origin-Opener-Policy`, `Origin-Agent-Cluster`, and a few legacy ones) are harmless here. `Strict-Transport-Security` is turned off, since browsers ignore it over plain HTTP and a hosted edge will decide it.
- **Why no router or state package.** There are four routes, and one piece of shared state, a batch's `BatchView`. `router.tsx` and `useBatch` together are about 150 lines, and a router would add more than that to the bundle and the dependency list.

## Routes

- **Why targets are taken exactly.** `decide` also takes patterns, where `*` matches anything, and a story's ID comes from a project's built Storybook. An ID `a*` passed as a pattern also approves `ab`, which the reviewer never saw. `cli/test/ui-*.test.ts` checks this with those two IDs.
- **Why a request names hashes.** A decision belongs to a name and a hash, so naming them says what the reviewer saw. A later accepted batch can change a baseline's goldens, and so a batch's differences, while a page is open. `stale-decision` is the difference between a confused screen and a wrong approval.
- **Why bulk has no route of its own.** A server-side "all" would approve whatever is there at that moment, and the dialog would describe something else.

## Recomputing

- **Why only `focus`.** Returning to a tab fired both `visibilitychange` and `focus`, which was two reads each time, measured in a browser. `focus` alone fires for a tab and for a window.
- **Why abort, and at an action's answer too.** A read sent while a decision is on its way can reflect the store before it, and arrive after it. Aborting it when the answer lands discards exactly that one.

## Screens

- **Why moves and spacing are a filter, not a pass.** On one real layout shift, 59 of 134 stories had nothing else in them. Looking through them one at a time is the cost the label should save, and `kind` must not decide for anyone (`cli.rationale.md`), so the filter lets a person see just those, glance over the thumbnails, and approve what's shown.
- **Why a list even for one hunk.** A whole-image approval is the case of one hunk, so the screen shouldn't have two shapes, and a person learns one way of looking.
- **Why a flip holds the hunk still.** Once something above a hunk has changed height, the hunk is at a different place in each image, and a flip shows the page jump and nothing about the hunk. The 9-slice already knows which boxes correspond, so the scroll follows them. It's only while looking at a hunk, since flipping with none costs no scroll.
- **Why stacking recenters.** A real change in the end-to-end Storybook, 278 pixels at the two ends of a 1186×30 box, showed nothing at all at the box's center at 8×. The first changed pixel always shows one.
- **Why `firstChanged` is in `PixelDiff`.** The diff loop already visits every pixel, and only the server has the pixels at no extra cost. It adds one field to `selfie review`'s document.
- **Why two kinds of size.** 1× was one CSS pixel at first, so that an image wouldn't be half the width on some screens and not others. Actual size now gives that consistent size, and a person looking for one wrong pixel needs to know what a pixel on their screen is, which only device pixels can say. A 1× image on a 2× display is half its actual width at 1×, and that's the point of choosing it.
- **Why the layers stay stacked.** A reviewer finding a 1 px change flips between two images and watches for what moves, which only works with no shift and no flash. Each layer's key is its URL, so moving to another story can't show the last story's image while its own loads, which could otherwise get the wrong image approved.
- **Why reuse a review's stats.** A later accepted batch could change a baseline's goldens under a batch, and then `review.json`'s stats would describe the old pair while the images show the new one. That's rare, and it only misstates numbers, against a request for every story.
- **Why thumbnails, given they cost a read each.** They're lazy, and 30 load on opening a 512 row list. They let someone scan for the one that's different, which pixel counts don't.

**Live stories.** Closed by default since a page per side is a lot to load for what most reviews don't need. They lay out at the rendered viewport and scale to fit, since a story laid out at half the width could look nothing like its image. Each side has its own size, since a story can declare one at one commit and not the other. They're a map of the few stories with a size of their own, beside the one size, rather than a field on every row, since nearly every row would hold the same thing. They aren't frozen, as a render is, so they can differ from an image without anything being wrong, which the screen says. Each story gets a new frame, since moving one frame along would add to the browser's history, and Back would walk through stories in it.

**A story taking the keyboard.** Measured on Dormouse's terminal story, 2026-11: it focuses itself as it loads, so every key on the page went into the story, and pressing `m` did nothing. The page can't tell a story not to, so it takes focus back, unless the pointer is over the frame, which is what a click there means.

**Storybook's own icons in the list.** Everything else here is Primer and Octicons, but this list is a picture of Storybook's sidebar, so it uses what that does: `@storybook/icons` (MIT), with the colors its sidebar was measured using, 2026-11. An approximation looked close, and still wasn't the thing people recognize.

**`/` is every story.** It used to go to the newest batch at HEAD, or stop at "No batches yet", which is where a first batch landed, with nothing to do there. A story is there to look at before any batch exists, so that's the place to start, and a batch is a step reached from it.

**A checklist, not an error from `selfie`.** A person's first `selfie` in a repository usually has no built Storybook, and maybe no config. Stopping with an error leaves them with a sentence to act on and no page, and then they have to start it again. Each line is only ever a fact the server can read, so the same list explains a new commit with nothing rendered at it, and there's no "first batch" to remember. A built Storybook that isn't ignored by Git is worth naming: it marks every render as uncommitted, and was found by trying this on a new repository.

**What "clean" can mean.** A built Storybook may not have been made by Selfie, so nothing records what it came from. Comparing its time with when HEAD last moved, from the reflog, catches a commit or checkout since it was built, which the commit's own time wouldn't for moving to an older commit. It can't catch changes that were there during a build and then reverted, which is why it's a time and not a guarantee.

**A rename is only said.** Storybook gives a story its ID from its title and name, so moving one reads as one removed and one new. An identical image is good evidence and not proof, so it changes what a person reads and not what's recorded: a golden still needs approving under its new name, and its loss still needs acknowledging. A rename that also changed pixels reads as a new and a removed, since no comparison is made across names.

**A sidebar, as in Storybook.** With the list as a page of its own, moving between stories meant going back to it, and a person who knows Storybook looks left for them. It takes the table's columns with it, so a row says only a story's state and any caveat, and a story's page says the rest.

**Every story, on the same page.** Separate pages for renders and for a live Storybook would be two products to learn, and every feature would need building twice. So the list merges what's been rendered, and a story's page is simply its batch's. It reads batches newest first and stops once each story has an answer, since each costs a comparison. If a story's never been rendered, that's every batch at the commit, which is the cost to watch.

**Rendering here.** Most iterating is on one story, and 1.7 s was measured for one story of Dormouse's 568 in the pinned container, 2026-11, so asking from the page is about as quick as looking away. It doesn't build, so an agent or person rebuilds, and what's rendered is whatever is hosted. A filtered batch can't become goldens, so Render the rest can't either, once it's a subset: only a whole batch from a clean build can. Every story at once is the one case worth treating as a whole batch.

## Keyboard

- **Why ignore repeats.** With `a` moving on to the next story, a held key would approve one image every few milliseconds. `j` and `k` lose little by it.
- **Why no arrow keys.** They scroll the stacked viewport, which is how it pans from the keyboard.

## Stories

**What reviewing itself found, the first time.** 59 stories in about 8 s, and two renders matched on all 59. A change to the batch screen's list and headings flagged exactly the 18 batch screen stories and left the other 41 unchanged, and 5 of the 18 were `size-differs`, because a heading or row moving changed the page's height. The stories first showed dark mode broken, which was the preview missing what `ui/index.html` sets, and not the app: a stable image isn't a correct one, so look at them.

## Accessibility

axe-core 4.10.3 was run on the no batches, no commits, run, filtered batch, accept, side by side, stacked, and shortcuts screens in a real browser. It found one issue, a link in text told apart only by color. Primer's `inline` underlines one only under `data-a11y-link-underlines="true"`, so `ui/index.html` sets that on the body. Primer's own components passed.

## Scale

Measured in headless Chromium through Playwright on a Mac, on a copy of the end-to-end store, against a batch of 541 stories with 512 listed, all new, and its batch directory pruned:

| What | Measured |
|---|---|
| Opening the batch, to the table on screen | 130 ms |
| Elements on the page | 10,941 |
| Image requests before scrolling | 29 |
| Image requests after scrolling 9,000 px | 136 |
| A keystroke in the filter, to the next frame | 14 to 25 ms |
| 10 presses of `j` | 67 ms |
| Reject 512 at once, to the words on screen changing | 140 ms |
| Approve 512 at once, to the words on screen changing | 367 ms |

Comparing before and after the reduction in comparisons, each from the same copy of the store and median of several, with SQL requests counted at the adapter, one of which is one D1 request:

| What | Before | After |
|---|---|---|
| The server's work for approving one | 11 requests, 4 comparisons, 32 ms | 6 requests, 2 comparisons, 26 ms |
| The server's work for bulk approving 512 | 11 requests, 4 comparisons, 36 ms | 6 requests, 2 comparisons, 28 ms |
| One approve-and-next, with a first diff | 15 requests | 10 requests |
| Opening `/` with a batch to open | 2 requests, 36 ms | 1 request, 5 ms |
| Approving one, in a browser, to the next story on screen | 68 ms | 66 ms |
| Bulk approving 512, in a browser, to the screen recomputed | 324 ms | 322 ms |
| Regaining focus | 2 reads | 1 read |

So locally these change what a request costs a hosted store, not what a reviewer feels: SQLite is a few milliseconds, and the rest of a decision's time is Git, and React rendering.

- **Why no virtualized list.** These numbers leave nothing for one to fix, and a real table keeps find-in-page and screen readers working. It's worth revisiting at far more than 541 rows.
- **Why no `content-visibility` on rows.** Primer's table makes each row a subgrid, and containment breaks that: in a browser, with it on `tbody tr`, every cell of every row collapsed to the first column's left edge, at 24 px. Focus return and `j` and `k` still worked, and it saved about 50 ms of main-thread time on opening 512 rows, which isn't a reason to take a table apart.
