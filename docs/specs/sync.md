# Sync

> Status: built, between a client and any server that mounts the routes. Nothing deployed mounts them yet. They've run on local stores, and inside workerd on its local D1 and R2, always with a stand-in for GitHub. See `## Future`.
>
> - Owns moving batches, images, decisions, and goldens between stores, and the routes and commands that do it. `docs/specs/renders.md` owns what each store does with them, `docs/specs/access.md` who may ask, and `docs/specs/system.md` where cloud data lives.

## What can disagree

| Data | Across stores | Rule |
|---|---|---|
| Images | Named by hash, so never, unless a client [lied or broke](#what-a-store-takes) | Send what's missing |
| Finished batches | Keep their ID, and never change, so never | Send what's missing |
| Decisions | One per name and hash, so yes | Latest wins (`docs/specs/renders.md` → Decisions) |
| Goldens | One batch per SHA and environment, so yes | [The cloud decides](#goldens) |

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
| `GET /batches/:id` | `?after`, where `next` said the page starts, a page of the batch in no particular order, each render, and the decision on each image, with `next` | View |
| `POST /decisions` | `{ environment, decisions }`, at most 1,000, each with its `gitSha` and `batchId` | Decide |
| `POST /goldens` | `{ batchId, baselineSha, removed }`, answers `{ outcome, acceptedBatchId, refusal }`, where `outcome` is `accepted`, `already`, `conflict`, or `refused` | Upload, or Decide if `removed` isn't empty |
| `GET /goldens` | `?sha&environment`, answers `{ batchId }` | View or Upload |
| `POST /goldens/first` | `{ shas, environment }`, at most 1,000, answers `{ sha }`, the first with goldens | View or Upload |

| Status | Code | When |
|---|---|---|
| 400 | `bad-request`, `bad-image` | It can't be understood, or isn't in a form a store keeps |
| 403 | `not-allowed` | The token can do something here, but not this |
| 404 | `not-found`, `unknown-batch`, `unknown-image` | The project can't be seen, or doesn't hold that |
| 409 | `batch-dirty`, `commit-not-pushed`, and `BatchError`'s other codes | The request can't apply to the data as it stands |
| 413 | `image-too-large` | It's more than the server takes |

Inside `POST /goldens`, a refusal is an answer, with a code of `not-approved`, `wrong-removed`, `goldens-conflict`, or one of `BatchError`'s, and status 200.

- **Must answer 404, identical to a project that doesn't exist, to anyone who can do nothing there, before reading anything else about the request, and 403 to anyone who can do something, but not this** (`docs/specs/access.md` → Who can do what).
- **Must take who's asking only from a bearer token**, never a cookie, so another site's page can't make these requests on someone's behalf.
- **Must keep what decides access, and whether GitHub has a commit, behind a seam the routes are given**, so they run on any platform, and are tested without GitHub.
- **Must let Upload learn which SHAs have goldens, and no more**, so that CI on a private repository knows its baseline without being able to view it. CI uploads and leaves comparing to the cloud.

### What a store takes

- **Must refuse a batch from a dirty tree, and a batch whose commit GitHub doesn't have, with `commit-not-pushed`, when the batch is first sent, and before any of its images**, so a forgotten `git push` costs nothing, and nothing from an unpushed commit is ever stored, since anyone can view a public repository's images (rationale). That a batch is clean is only what its client says, so this holds for honest clients.
- **Must take an image through `ReceivingStore.receiveImage`, and never decode it**, since anyone who can upload can already approve (rationale). It answers `bad-image` for a file that isn't in a form a store keeps. A corrupt body, or one holding another picture, gets through (`docs/specs/store.md` → Image identity), and stays until [something can replace it](#not-yet).
- **Must refuse an image larger than the server takes, before reading it**, with `image-too-large`.
- **Must take a decision only from someone who may decide, so a CI upload carries none**, and record a new one's author as whoever is pushing, as the server knows them, not what the client says (rationale). A decision the server already holds keeps its author. `docs/specs/renders.md` → Decisions says stores agree on the verdict, which the author need not match.
- **Must not let a received decision's time, or a batch's, be later than the server's clock**, so a wrong clock can't win every later disagreement, or post-date a batch. Sending a batch again keeps the time it was first given.

Reserved: a fork's render pass must not upload through this (`docs/specs/access.md` → Open questions).

### Goldens

**The cloud decides a SHA's goldens**, since they're what everyone's reviews are held to.

- **Must run goldens through `acceptBatch` on the server**, against what it now holds, so nothing is taken on trust. `trust` is a separate scope. A refusal is an answer, and leaves the batch there.
- **Must let CI make goldens, with Upload alone, if the batch removes nothing**, since accepting then adds no judgment: each image already matches the baseline, or was approved by someone who may decide. This is how a merge commit gets goldens without a person re-rendering it (rationale).
- **Must hold a batch to the baseline the sender names, which must have goldens here**, since no batch records one, and CI on a private repository can't pull. CI's sequence is `selfie render`, then `selfie push --accept` (rationale).
- **Must need Decide for goldens that remove anything, have the sender name what it counted as removed, and refuse with `wrong-removed` if that isn't what the server finds**, in place of a count, since the local count isn't kept, and the two stores' baselines could differ.
- **Must never replace a SHA's goldens this way.** If the cloud has a different batch there, it answers `conflict` with that batch's ID. Nothing can replace them yet ([Not yet](#not-yet)).
- **Must refuse goldens whose baseline's goldens aren't here with `no-goldens`**. Nothing reaches back through history.

## Pushing and pulling

Source of truth: `cli/src/sync.ts`; tests in `cli/test/sync.test.ts`, between two machines on real Git and a store standing in for the cloud's.

- **Must push one batch at a time, in this order: the batch, its images, its renders, finishing it, its decisions, and its goldens**, so that a refused batch costs nothing, and nothing refers to what hasn't arrived.
- **Must make every step safe to send again**, so a push or pull that dies is finished by running it again, with nothing to clean up. A partly received batch stays `recording`, which nothing can compare or accept.
- **Must send only the images the receiver lacks, and pull only those this store lacks, decoding each to check it's the image its hash names**, and stop with `corrupt-image` naming it if it isn't, leaving what's stored here as it was. A sender's check is the last that image gets, and a puller's is the only one that finds what another client sent wrongly.
- **Must carry `reusedFromBatch`**, for `trust`. It may name a batch never pushed.
- **Must send only the decisions on the batch's own images, each with the commit it counts from**, which are the ones that carry through a push (`docs/specs/system.md` → Approvals across stores).
- **Must ask first what the token may do, and skip what it can't, saying so**, so that CI isn't refused after uploading everything.
- **Must let a pull replace a SHA's local goldens with the cloud's, and say so**, through `adoptGoldens`. Its decisions merge, so a later one here stands.
- **Must read nothing more once a SHA's goldens here are already the cloud's**, since a shared limit pays for every pull CI makes.

## Commands

| Command | Prints | Exits |
|---|---|---|
| `selfie push [<batch>] [--accept] [--remote <url>] [--native]` | `batchId`, `images: { sent, alreadyThere }`, `decisions`, null if the token can't decide, and `goldens`, null if none were asked for | 0 if it all went, 1 if goldens were refused or conflict, 2 if it couldn't run |
| `selfie pull [<commit>] [--remote <url>] [--native]` | `sha`, `environment`, `batchId`, `images: { received, alreadyHere }`, `decisions`, and `replaced` | 0 with goldens, 1 if the remote has none, 2 if it couldn't run |

A push sends a batch's goldens if they're here, which only a pull makes them, or `--accept` asks for them, which is what CI uses on a merge commit. It defaults to the newest finished batch from a clean tree at HEAD. A pull defaults to the nearest baseline the remote has.

- **Must find a repository's project from its GitHub origin**, by the owner and name there, and use the numeric ID the server answers (`docs/specs/access.md` → GitHub App).
- **Must take the remote's address only from `--remote` or `SELFIE_REMOTE`, and the token only from `SELFIE_TOKEN`, never from `selfie.config.json`**, since a checkout must not be able to send someone's token to another server (`docs/specs/cli.md` → Commands). Signing in replaces the token with **Scope: github-access**.
- **Must refuse a remote that isn't https, unless it's this machine**, since a token goes to it.

## Future

**Scope: cloud-deploy** mounts the routes, and **Scope: github-access** answers the seam, both defined in `docs/specs/system.md` → Build order.

### At scale

A project's first push is the expensive one. Each new image takes one upload and one D1 request, so 10,000 new images are about 10,000 requests, or about 42 minutes of the shared limit of 1,200 per 5 minutes (`docs/specs/store.md` → D1 REST adapter), by calculation and not measurement. Before a real project pushes, **Scope: cloud-deploy** needs to pace uploads, or add them another way than through that limit.

### Not yet

- Replacing an image the cloud holds wrongly. Today a pull of it fails, naming it, every time, and a browser shows it as it is. A repair needs someone with write access, and a client that decodes.
- Decisions on hunks (`docs/specs/renders.md` → Future), which add their own table, and travel the same way.
- Notes (**Scope: remote-notes**, `docs/specs/feedback.md`).
- Pulling a batch other than a commit's goldens.
- Replacing a SHA's goldens in the cloud, which also clears a `conflict`. It would be `POST /goldens` with `replaces`, needing Decide, which `selfie push` never sends.
- Moving the routes out of `selfie-ui`, with `app.ts`, once **Scope: cloud-deploy** needs them without a build of the page.
