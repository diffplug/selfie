# Sync

> Status: partly built — the routes, and the store's half of them (`docs/specs/snapshots.md`). Nothing mounts or calls them yet. See `## Future`.
>
> - Owns moving runs, images, decisions, and goldens between stores, and the routes and commands that do it. `docs/specs/snapshots.md` owns what each store does with them, `docs/specs/access.md` who may ask, and `docs/specs/system.md` where cloud data lives.

## What can disagree

| Data | Across stores | Rule |
|---|---|---|
| Images | Named by hash, so never | Send what's missing |
| Finished runs | Keep their ID, and never change, so never | Send what's missing |
| Decisions | One per name and hash, so yes | Latest wins (`docs/specs/snapshots.md` → Decisions) |
| Goldens | One run per SHA and environment, so yes | [The cloud decides](#goldens) |

## Routes

Source of truth: `ui/src/server/sync.ts`, exported as `selfie-ui/sync`, and `ui/src/shared/sync-api.ts`, as `selfie-ui/sync-api`, for what crosses the wire; tests in `cli/test/sync-routes.test.ts`, on a real store with a stand-in for GitHub.

To mount under `/api`. `GET /repositories/:owner/:name` finds a repository's project. The rest are under `/projects/:project`, where `:project` is the repository's numeric ID (`docs/specs/access.md` → GitHub App). Every one is JSON but an image's bytes.

| Route | Does | Needs |
|---|---|---|
| `GET /` | What the token may do here: `{ view, upload, decide }` | Any |
| `PUT /runs/:id` | Starts holding a run, and answers how far it got | Upload |
| `POST /images/missing` | `{ hashes }`, at most 500, answers `{ missing }` | Upload |
| `PUT /images/:hash` | Stores the image's bytes as the sender's store holds them | Upload |
| `GET /images/:hash` | The stored bytes | View |
| `POST /runs/:id/snapshots` | `{ snapshots }`, at most 1,000 | Upload |
| `POST /runs/:id/finish` | `{ count, finishedAt }` | Upload |
| `GET /runs/:id` | `?after`, a page of the run, each snapshot, and the decision on each image, with `next` | View |
| `POST /decisions` | `{ environment, decisions }`, at most 1,000 | Decide |
| `POST /goldens` | `{ runId, removed }`, answers `{ outcome, acceptedRunId, refusal }`, where `outcome` is `accepted`, `already`, `conflict`, or `refused` | Upload, or Decide if `removed` isn't empty |
| `GET /goldens` | `?sha&environment`, answers `{ runId }` | View or Upload |
| `POST /goldens/first` | `{ shas, environment }`, at most 1,000, answers `{ sha }`, the first with goldens | View or Upload |

| Status | Code | When |
|---|---|---|
| 400 | `bad-request`, `hash-mismatch`, `bad-image` | It can't be understood, or isn't the image it's sent as |
| 403 | `not-allowed` | The token can do something here, but not this |
| 404 | `not-found`, `unknown-run`, `unknown-image` | The project can't be seen, or doesn't hold that |
| 409 | `run-dirty`, `commit-not-pushed`, and `SnapshotError`'s other codes | The request can't apply to the data as it stands |
| 413 | `image-too-large` | It's more than the platform can afford to verify |

Inside `POST /goldens`, a refusal is an answer, with a code of `not-approved`, `wrong-removed`, `goldens-conflict`, or one of `SnapshotError`'s, and status 200.

- **Must answer 404, identical to a project that doesn't exist, to anyone who can do nothing there, before reading anything else about the request, and 403 to anyone who can do something, but not this** (`docs/specs/access.md` → Who can do what).
- **Must take who's asking only from a bearer token**, never a cookie, so another site's page can't make these requests on someone's behalf.
- **Must keep what decides access, and whether GitHub has a commit, behind a seam the routes are given**, so they run on any platform, and are tested without GitHub.
- **Must let Upload learn which SHAs have goldens, and no more**, so that CI on a private repository knows its baseline without being able to view it. CI uploads and leaves comparing to the cloud.

### What a store takes

- **Must refuse a run from a dirty tree, and a run whose commit GitHub doesn't have, with `commit-not-pushed`, when the run is first sent, and before any of its images**, so a forgotten `git push` costs nothing, and nothing from an unpushed commit is ever stored, since anyone can view a public repository's images (rationale). That a run is clean is only what its client says, so this holds for honest clients.
- **Must verify every image against the hash it's sent under, before storing anything**, and refuse a mismatch with `hash-mismatch`, since an image hash names exactly one image in every store.
- **Must refuse an image larger than the platform says it can afford, before reading it**, with `image-too-large`, and never store one unverified. How many pixels a Worker can verify is still to settle (`docs/specs/store.md` → Future).
- **Must take a decision only from someone who may decide, so a CI upload carries none**, and record a new one's author as whoever is pushing, as the server knows them, not what the client says (rationale). A decision the server already holds keeps its author. `docs/specs/snapshots.md` → Decisions says stores agree on the verdict, which the author need not match.
- **Must not let a received decision's time, or a run's, be later than the server's clock**, so a wrong clock can't win every later disagreement, or post-date a run. Sending a run again keeps the time it was first given.

### Goldens

**The cloud decides a SHA's goldens**, since they're what everyone's reviews are held to.

- **Must run goldens through `acceptRun` on the server**, against what it now holds, so nothing is taken on trust. `trust` is a separate scope. A refusal is an answer, and leaves the run there.
- **Must let CI make goldens, with Upload alone, if the run removes nothing**, since accepting then adds no judgment: each image already matches the baseline, or was approved by someone who may decide. This is how a merge commit gets goldens without a person re-rendering it (rationale).
- **Must need Decide for goldens that remove anything, have the sender name what it counted as removed, and refuse with `wrong-removed` if that isn't what the server finds**, in place of a count, since the local count isn't kept, and the two stores' baselines could differ.
- **Must never replace a SHA's goldens this way.** If the cloud has a different run there, it answers `conflict` with that run's ID. Nothing can replace them yet ([Not yet](#not-yet)).
- **Must refuse goldens whose baseline's goldens aren't here with `no-goldens`**. Nothing reaches back through history.

## Future

**Scope: sync** is defined in `docs/specs/system.md` → Build order. **Scope: cloud-deploy** mounts the routes, and **Scope: github-access** answers the seam.

### Pushing and pulling

- **Must push one run at a time, in this order: the run, its images, its snapshots, finishing it, its decisions, and its goldens**, so that a refused run costs nothing, and nothing refers to what hasn't arrived.
- **Must make every step safe to send again**, so a push that dies is finished by pushing again, with nothing to clean up. A partly received run stays `recording`, which nothing can compare or accept.
- **Must send only the images the receiver lacks**, and pull only those this store lacks.
- **Must carry `reusedFromRun`**, for `trust`. It may name a run never pushed.
- **Must send only the decisions on the run's own images**, which are the ones that carry through a push (`docs/specs/system.md` → Approvals across stores).
- **Must let a pull replace a SHA's local goldens with the cloud's, and say so**, through `adoptGoldens`.

### Commands

- `selfie push [<run>] [--accept]` pushes a run, by default the newest at HEAD. It asks first what the token may do, and skips what it can't, saying so, so that CI isn't refused after uploading everything. It sends goldens if the run is accepted locally, or `--accept` asks for them, which is what CI uses on a merge commit. It prints what it sent, with `goldens` saying what became of them. Exits 0 if it all went, 1 if goldens were refused or conflict, and 2 if it couldn't run.
- `selfie pull [<commit>]` pulls a commit's goldens, by default the baseline. It prints what it took, and whether it replaced local goldens.
- `find-baseline` asks the cloud as well as the local store, for the nearest of either, when a remote is set. It must still answer from local data if the cloud can't be reached, and say so, so a review never fails because of the network.
- **Must take the remote's address only from `--remote` or `SELFIE_REMOTE`, and the token only from `SELFIE_TOKEN`, never from `selfie.config.json`**, since a checkout must not be able to send someone's token to another server (`docs/specs/cli.md` → Commands). Signing in replaces the token with **Scope: github-access**.

### Not yet

- Decisions on regions (`docs/specs/snapshots.md` → Future), which add their own table, and travel the same way.
- Notes (**Scope: remote-notes**, `docs/specs/feedback.md`).
- A review pulling its baseline by itself. For now it says to run `selfie pull`.
- Replacing a SHA's goldens in the cloud, which also clears a `conflict`. It would be `POST /goldens` with `replaces`, needing Decide, which `selfie push` never sends.
- Moving the routes out of `selfie-ui`, with `app.ts`, once **Scope: cloud-deploy** needs them without a build of the page.
