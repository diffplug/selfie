# Sync

> Status: built, and mounted by the Worker at `app.selfie.dev` (`docs/specs/cloud.md`). `selfie push` runs against it from CI. See `## Future`.
>
> - Owns moving batches, images, and decisions between stores, and the routes and commands that do it. `docs/specs/renders.md` owns what each store does with them, `docs/specs/access.md` who may ask, and `docs/specs/system.md` where cloud data lives.

## What can disagree

| Data | Across stores | Rule |
|---|---|---|
| Images | Named by hash, so never, unless a client [lied or broke](#what-a-store-takes) | Send what's missing |
| Finished batches | Keep their ID, and never change, so never | Send what's missing |
| Decisions | One per name, hash, and commit, so yes | Latest wins (`docs/specs/renders.md` → Decisions) |

## Routes

Source of truth: `ui/src/server/sync.ts`, exported as `selfie-ui/sync`, and `ui/src/shared/sync-api.ts`, as `selfie-ui/sync-api`, for what crosses the wire; tests in `cli/test/sync-routes.test.ts`, on a real store with a stand-in for GitHub, and `ui/test/workerd/sync.workerd.test.ts`, inside workerd.

To mount under `/api`. `GET /repositories/:owner/:name` finds a repository's project. The rest are under `/projects/:project`, where `:project` is the repository's numeric ID (`docs/specs/access.md` → GitHub App). Every one is JSON but an image's bytes.

| Route | Does | Needs |
|---|---|---|
| `GET /` | What the token may do here: `{ view, upload, decide }` | Any |
| `PUT /batches/:id` | Starts holding a batch, and answers how far it got | Upload |
| `POST /images/missing` | `{ hashes }`, at most 500, answers `{ missing }` | Upload |
| `PUT /images/:hash` | Stores the image's bytes as the sender's store holds them | Upload |
| `GET /images/:hash` | The stored bytes | View |
| `POST /batches/:id/renders` | `{ renders }`, at most 1,000 | Upload |
| `POST /batches/:id/finish` | `{ count, finishedAt }` | Upload |
| `POST /batches/:id/status` | Says what this batch's commit reads as, where people look (`docs/specs/cloud.md` → Commit status) | Upload |
| `POST /commits` | `{ commits }`, at most 1,000, each `{ sha, parents }`, so a server with no Git knows what a commit reaches | Upload |
| `GET /storybooks/:hash` | `{ kept }` | Upload |
| `POST /storybooks/files/missing` | `{ hashes }`, at most 500, answers `{ missing }` | Upload |
| `PUT /storybooks/files/:hash` | A file's bytes, which must hash to that | Upload |
| `PUT /storybooks/:hash` | `{ files }`, each `{ path, fileHash }`, once all are here, or `missing-files` | Upload |
| `POST /batches/:id/storybook` | `{ build }`, which built Storybook rendered this batch | Upload |
| `GET /batches/:id/diffs/needed` | `{ pairs }`, each `{ current, golden }`, the changed pairs with no diff here, including those of what's been approved since its base (`docs/specs/renders.md` → Approved since a base) and of what's changed since it (`docs/specs/renders.md` → Changed since a base) | Upload |
| `PUT /diffs/:current/:golden/image` | The diff image's bytes, sent first | Upload |
| `PUT /diffs/:current/:golden` | Its `PixelDiff`, which says both are here | Upload |
| `POST /decisions` | `{ environment, decisions }`, at most 1,000, each with its `gitSha` and `batchId`, and a null `imageHash` for a removal | Decide |
| `POST /decisions/reached` | `{ environment, commits }`, at most 1,000, answers `{ decisions }`: what counts of those made at them, each with its `gitSha` and `batchId` | View |
| `POST /batches/base` | `{ environment, branch, gitSha, commits }`, at most 1,000 commits, answers `{ batch }`: the newest finished batch of `branch` in `environment` at any of `commits` other than `gitSha`, which it may never have heard of, or null (`docs/specs/renders.md` → Approved since a base) | View |
| `GET /batches/:id/renders?after=` | A finished batch's renders, `{ renders, next }`, at most 1,000 to a page, each `{ story, imageHash, failure, viewport }` as it was sent; `next` is the next page's `after`, or null after the last | View |

| Status | Code | When |
|---|---|---|
| 400 | `bad-request`, `bad-image` | It can't be understood, or isn't in a form a store keeps |
| 403 | `not-allowed` | The token can do something here, but not this |
| 404 | `not-found`, `unknown-batch`, `unknown-image` | The project can't be seen, or doesn't hold that |
| 409 | `batch-dirty`, `commit-not-pushed`, and `BatchError`'s other codes | The request can't apply to the data as it stands |
| 413 | `image-too-large` | It's more than the server takes |

- **Must answer 404, identical to a project that doesn't exist, to anyone who can do nothing there, before reading anything else about the request, and 403 to anyone who can do something, but not this** (`docs/specs/access.md` → Who can do what).
- **Must take who's asking only from a bearer token**, never a cookie, so another site's page can't make these requests on someone's behalf.
- **Must keep what decides access, and whether GitHub has a commit, behind a seam the routes are given**, so they run on any platform, and are tested without GitHub.

### What a store takes

- **Must refuse a batch from a dirty tree, and a batch whose commit GitHub doesn't have, with `commit-not-pushed`, when the batch is first sent, and before any of its images**, so a forgotten `git push` costs nothing, and nothing from an unpushed commit is ever stored, since anyone can view a public repository's images (rationale). That a batch is clean is only what its client says, so this holds for honest clients.
- **Must take an image through `ReceivingStore.receiveImage`, and never decode it**, since anyone who can upload can already approve (rationale). It answers `bad-image` for a file that isn't in a form a store keeps. A corrupt body, or one holding another picture, gets through (`docs/specs/store.md` → Image identity), and stays until [something can replace it](#not-yet).
- **Must refuse an image larger than the server takes, before reading it**, with `image-too-large`.
- **Must take a decision only from someone who may decide, so a CI upload carries none**, and record a new one's author as whoever is pushing, as the server knows them, not what the client says (rationale). A decision the server already holds keeps its author. `docs/specs/renders.md` → Decisions says stores agree on the verdict, which the author need not match.
- **Must not let a received decision's time, or a batch's, be later than the server's clock**, so a wrong clock can't win every later disagreement, or post-date a batch. Sending a batch again keeps the time it was first given.

Reserved: a fork's render pass must not upload through this (`docs/specs/access.md` → Open questions).

## Pushing and pulling

Source of truth: `cli/src/sync.ts`; tests in `cli/test/sync.test.ts`, between two machines on real Git and a store standing in for the cloud's.

- **Must try a request up to three times if the server can't be reached, or answers 429 or 5xx**, since every step is safe to send again.
- **Must push one batch at a time, in this order: the batch, what its commit reaches, its built Storybook if it's kept, its images, its renders, finishing it, its decisions, saying its status, and the diffs the remote asks for**, so that a refused batch costs nothing, and nothing refers to what hasn't arrived.
- **Must make every step safe to send again**, so a push or pull that dies is finished by running it again, with nothing to clean up. A partly received batch stays `recording`, which nothing can compare.
- **Must send only the images the receiver lacks, and pull only those this store lacks, decoding each to check it's the image its hash names**, and stop with `corrupt-image` naming it if it isn't, leaving what's stored here as it was. A sender's check is the last that image gets, and a puller's is the only one that finds what another client sent wrongly.
- **Must carry `reusedFromBatch`**, for `trust`. It may name a batch never pushed.
- **Must send what its commit reaches, by the same rule as a pull, that's on the batch's own images or a story being gone, each with the commit it counts from**, which are the ones that carry through a push (`docs/specs/system.md` → Approvals), since the remote may hold no other image.
- **Must ask first what the token may do, and skip what it can't, saying so**, so that CI isn't refused after uploading everything.
- **Must pull what a commit reaches by sending its ancestors, not by the remote's graph**, so a commit that hasn't been pushed yet can still read what its history approved.
- **Must answer a pull with only what can change what a story reads as: each story's decisions, newest first, back through its second-newest approval**, and fetch only their images, so a long history doesn't mean fetching every image it ever approved (rationale).
- **Must merge what's pulled**, so a later decision here stands (`docs/specs/renders.md` → Decisions).
- **Must pull, after the decisions, the commit's base on the default branch, as this store names that branch (`docs/specs/cli.md` → Git), by the same ancestors, never at the commit itself**, so a branch can be told apart from a default branch nobody renders here (`docs/specs/renders.md` → Approved since a base) (rationale).
- **Must record a pulled base under its own ID, with its facts, its renders, and the time it finished, as the remote received it, and fetch nothing of it if it's here already finished**, so it reads as any batch here does, and pulling it again is free. Its images come before it, so one that isn't what its hash names leaves no batch. Its built Storybook doesn't come ([Not yet](#not-yet)).

## Commands

| Command | Prints | Exits |
|---|---|---|
| `selfie push [<batch>] [--remote <url>] [--native]` | `batchId`, `images: { sent, alreadyThere }`, `decisions`, null if the token can't decide, `storybook`, and `diffs` | 0 if it all went, 2 if it couldn't run |
| `selfie pull [<commit>] [--remote <url>] [--native]` | `sha`, `environment`, `images: { received, alreadyHere }`, `decisions`, and `base: { batchId, gitSha, images: { received, alreadyHere } }`, null if there's none to take | 0 if it all came, whether or not there was anything to take, 2 if it couldn't run |

A push defaults to the newest finished batch from a clean tree at HEAD. A pull defaults to HEAD, and the base it takes is never at the commit pulled, so a push that follows doesn't send it.

- **Must find a repository's project from its GitHub origin**, by the owner and name there, and use the numeric ID the server answers (`docs/specs/access.md` → GitHub App).
- **Must take the remote's address only from `--remote` or `SELFIE_REMOTE`, and the token only from `SELFIE_TOKEN`, never from `selfie.config.json`**, since a checkout must not be able to send someone's token to another server (`docs/specs/cli.md` → Commands). Signing in replaces the token with **Scope: github-access**.
- **Must refuse a remote that isn't https, unless it's this machine**, since a token goes to it.

## Future

`docs/specs/cloud.md` mounts the routes. **Scope: github-access** will answer the seam from GitHub, both defined in `docs/specs/system.md` → Build order.

### At scale

A project's first push is the expensive one. Each new image takes one upload and one D1 request, so 10,000 new images are about 10,000 requests, or about 42 minutes of the shared limit of 1,200 per 5 minutes (`docs/specs/store.md` → D1 REST adapter), by calculation and not measurement. Before a real project pushes, **Scope: cloud-deploy** needs to pace uploads, or add them another way than through that limit.

### Not yet

- Replacing an image the cloud holds wrongly. Today a pull of it fails, naming it, every time, and a browser shows it as it is. A repair needs someone with write access, and a client that decodes.
- Decisions on hunks (`docs/specs/renders.md` → Future), which add their own table, and travel the same way.
- Notes (**Scope: remote-notes**, `docs/specs/feedback.md`).
- Pulling a batch's built Storybook, for a story's reference to link to it locally. A pull brings decisions, their images, and a commit's base with its declared sizes, but no built Storybook, so a pulled reference shows no live story here.
- Pulling the decisions the base itself reaches. A pull brings each story's decisions the commit reaches back through its second-newest approval, so where a branch has approved a story twice since its base, the approval the base read it by may not come, and the base reads that story here as added.
- Moving the routes out of `selfie-ui`, with `app.ts`, once **Scope: cloud-deploy** needs them without a build of the page.
