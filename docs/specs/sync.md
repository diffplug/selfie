# Sync

> Status: design — nothing here is implemented yet, except the store's half in `docs/specs/snapshots.md`.
>
> - Owns moving runs, images, decisions, and goldens between stores, and the routes and commands that do it. `docs/specs/snapshots.md` owns what each store does with them, `docs/specs/access.md` who may ask, and `docs/specs/system.md` where cloud data lives.

## Future

**Scope: sync** is defined in `docs/specs/system.md` → Build order.

### What can disagree

| Data | Across stores | Rule |
|---|---|---|
| Images | Named by hash, so never | Send what's missing |
| Finished runs | Keep their ID, and never change, so never | Send what's missing |
| Decisions | One per name and hash, so yes | Latest wins (`docs/specs/snapshots.md` → Decisions) |
| Goldens | One run per SHA and environment, so yes | [The cloud decides](#goldens) |

### What goes

- **Must push one run at a time, in this order: its images, the run, its decisions, and its goldens if it's accepted locally**, so that nothing ever refers to something that hasn't arrived.
- **Must make every step safe to send again**, so a push that dies is finished by pushing again, with nothing to clean up. A partly received run stays `recording`, which nothing can compare or accept.
- **Must send only the images the receiver lacks**, and pull only those this store lacks.
- **Must refuse a `recording` run, a run from a dirty tree, and a run whose commit GitHub doesn't have, with `commit-not-pushed`, on the server, so it holds for every honest client**, since anyone can view a public repository's runs, and such a run may show work that's in no commit (rationale). That a run is clean is only what its client says.
- **Must verify every received image against the hash it's sent under**, through `Store.putImage`, and refuse a mismatch with `hash-mismatch`, since an image hash names exactly one image in every store.
- **Must carry `reusedFromRun`**, for `trust`. It may name a run never pushed.
- **Must send only the decisions on the run's own images**, which are the ones that carry through a push (`docs/specs/system.md` → Approvals across stores).
- **Must take a decision only from someone who may decide, so a CI upload carries none**, and record a new one's author as whoever is pushing, as the server knows them, not what the client says (rationale). A decision the server already holds keeps its author. `docs/specs/snapshots.md` → Decisions says stores agree on the verdict, which the author need not match.
- **Must not let a received decision's time, or a run's, be later than the server's clock**, so a wrong clock can't win every later disagreement, or post-date a run.

### Goldens

**The cloud decides a SHA's goldens**, since they're what everyone's reviews are held to.

- **Must run goldens through `acceptRun` on the server**, against what it now holds, so nothing is taken on trust. `trust` is a separate scope. A refusal is an answer, and leaves the run pushed.
- **Must let CI make goldens, with Upload alone, if the run removes nothing**, since accepting then adds no judgment: each image already matches the baseline, or was approved by someone who may decide. This is how a merge commit gets goldens without a person re-rendering it (rationale). `selfie push --accept` asks for it, whatever's accepted locally.
- **Must need Decide for goldens that remove anything, and have the sender name what it counted as removed, and refuse with `wrong-removed` if that isn't what the server finds**, in place of a count, since the local count isn't kept, and the two stores' baselines could differ.
- **Must never replace a SHA's goldens from a push.** If the cloud has a different run there, the push answers `conflict` with that run's ID, and exits 1. Nothing can replace them yet ([Not yet](#not-yet)).
- **Must let a pull replace a SHA's local goldens with the cloud's, and say so**, through `adoptGoldens`.
- **Must refuse goldens whose baseline's goldens aren't in the cloud with `no-goldens`**, and say to push that first. A push doesn't reach back through history.

### Routes

Under `/api/projects/:project`, where `:project` is the repository's numeric ID (`docs/specs/access.md` → GitHub App). Every one is JSON but an image's bytes.

| Route | Does | Needs |
|---|---|---|
| `GET /` | What the token may do here: `{ view, upload, decide }` | Any |
| `POST /images/missing` | `{ hashes }`, at most 500, answers `{ missing }` | Upload |
| `PUT /images/:hash` | Stores the image's bytes as the sender's store holds them | Upload |
| `GET /images/:hash` | The stored bytes | View |
| `PUT /runs/:id` | Starts holding a run, and answers how far it got | Upload |
| `POST /runs/:id/snapshots` | `{ snapshots }`, at most 1,000 | Upload |
| `POST /runs/:id/finish` | `{ count, finishedAt }` | Upload |
| `GET /runs/:id` | `?after`, a page of the run, each snapshot, and the decision on each image, with `next` | View |
| `POST /decisions` | `{ environment, decisions }`, at most 1,000 | Decide |
| `POST /goldens` | `{ runId, removed }`, answers `{ outcome, acceptedRunId, refusal }`, where `outcome` is `accepted`, `already`, `conflict`, or `refused` | Upload, or Decide if `removed` isn't empty |
| `GET /goldens` | `?sha&environment`, answers `{ runId }` | View or Upload |
| `POST /goldens/first` | `{ shas, environment }`, at most 1,000, answers `{ sha }`, the first with goldens | View or Upload |

- **Must answer 404, identical to a project that doesn't exist, to anyone who can do nothing there, and 403 to anyone who can do something, but not this** (`docs/specs/access.md` → Who can do what).
- **Must let Upload learn which SHAs have goldens, and no more**, so that CI on a private repository knows its baseline without being able to view it. CI uploads and leaves comparing to the cloud.
- **Must take who's asking only from a bearer token**, never a cookie, so another site's page can't make these requests on someone's behalf.
- **Must keep what decides access, and whether GitHub has a commit, behind a seam the routes are given**, so they run on any platform, and are tested without GitHub.

### Commands

- `selfie push [<run>] [--accept]` pushes a run, by default this folder's newest. It asks first what the token may do, and skips what it can't, saying so, so that CI isn't refused after uploading everything. It prints what it sent, with `goldens` saying what became of them. Exits 0 if it all went, 1 if goldens were refused or conflict, and 2 if it couldn't run.
- `selfie pull [<commit>]` pulls a commit's goldens, by default the baseline. It prints what it took, and whether it replaced local goldens.
- `find-baseline` asks the cloud as well as the local store, for the nearest of either, when a remote is set. It must still answer from local data if the cloud can't be reached, and say so, so a review never fails because of the network.
- **Must take the remote's address only from `--remote` or `SELFIE_REMOTE`, and the token only from `SELFIE_TOKEN`, never from `selfie.config.json`**, since a checkout must not be able to send someone's token to another server (`docs/specs/cli.md` → Commands). Signing in replaces the token with **Scope: github-access**.

### Not yet

- Decisions on regions (`docs/specs/snapshots.md` → Future), which add their own table, and travel the same way.
- Notes (**Scope: remote-notes**, `docs/specs/feedback.md`).
- A review pulling its baseline by itself. For now it says to run `selfie pull`.
- Replacing a SHA's goldens in the cloud, which also clears a `conflict`. It would be `POST /goldens` with `replaces`, needing Decide, which `selfie push` never sends.
- A very tall image at 2× may not fit a Worker's memory to verify (`docs/specs/store.md` → Future). It must be refused, never stored unverified.
