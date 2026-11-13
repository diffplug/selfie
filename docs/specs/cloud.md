# Cloud

> Status: built, and deployed at `app.selfie.dev`, for a few public repositories and one writer.
>
> - See `docs/specs/glossary.md` for vocabulary.
> - Owns the Worker: what it hosts, its pages and origins, how a project's data is reached with no Git and no image decoding, and a commit's status. `docs/specs/access.md` owns who may do what, `docs/specs/sync.md` the routes a push uses, and `docs/specs/ui.md` what the screens show.

## Projects

Source of truth: `ui/src/worker/index.ts`, `ui/src/worker/app.ts`, `ui/wrangler.toml`; tests in `ui/test/workerd/cloud.workerd.test.ts`, inside workerd, with a stand-in for GitHub.

- **Must list the projects it hosts in the Worker's own code**, each with its repository's numeric ID, owner, name, default branch, and D1 binding (rationale). A repository not listed is 404, whatever the GitHub App can reach.
- **Must answer a project's former names, listed with it**, a page or review route with a 308 to the same path under its name now, and `/api/repositories/:owner/:name` with the project, so a checkout whose `origin` still has the old name still pushes.
- **Must give each project a D1 database of its own, through a Worker binding, named `selfie-project-<id>`**, and its blobs a prefix of its own in one R2 bucket (`docs/specs/store.md` → R2 adapter).
- **Must set up a project's schema on its first request in a Worker's life.**
- **Never share work still under way from one request to another**, only what's finished, such as a kept built Storybook's stories once read, or knowing a schema is set up. A Worker's I/O belongs to the request that started it, so if that request is canceled, as a browser does on navigating away, anything else waiting on it hangs until the runtime gives up with a 503.

## Origins

- **Must serve the review page, its routes, the sync routes, and sign-in from `APP_ORIGIN`, `https://app.selfie.dev`, and kept built Storybooks only from `STORYBOOK_ORIGIN`, `https://selfieusercontent.com`, a different site**, since a built Storybook is the code of whatever branch was built, and on the app's site it could approve its own images (rationale).
- **Must answer each of `FORMER_ORIGINS`, `https://hackathon.selfie.dev`, with a 308 to the same path and query on `APP_ORIGIN`**, keeping the method and body for a `selfie push` still pointed there.
- **Must answer any other host with 421**, so no other name for the Worker is an alias for the app. The Worker has no workers.dev name.
- **Never serve the landing page from `APP_ORIGIN`.** `selfie.dev` is `site/`, on Cloudflare Pages, so nothing it loads shares an origin with the session cookie (rationale).
- **Must answer nothing on the Storybook origin but `/<project>/built-storybooks/<hash>/…`**, with `storybookHeaders` letting only itself and the review origin frame it.

## Pages

| Route | What it is |
|---|---|
| `/` | Redirects to the first project |
| `/sign-in` | A button that starts signing in through GitHub (`docs/specs/access.md` → Who can do what) |
| `/api/auth/callback/github` | GitHub's return from signing in, to pgstencil's adapter |
| `/signed-in` | Where the adapter sends a browser after GitHub: on to where it was going for the writer, and anyone else signed out and on to the mailing list (`docs/specs/access.md` → Who can do what) |
| `/sign-out` | Ends the session |
| `/api/…` | The sync routes (`docs/specs/sync.md` → Routes) |
| `/:owner/:repo/api/…` | The review routes (`docs/specs/ui.md` → Routes), with `pageHeaders` and `sameOriginWrites` |
| `/:owner/:repo`, `/:owner/:repo/…` | The client's one document, with `<meta name="selfie-base">` saying which project it's in |

- **Must keep every client path and request under that base**, through `BASE` in `ui/src/client/base.ts`, which is empty for a local server, whose paths don't change.
- **Must show a project's page from the newest finished batch on its default branch, or else the newest anywhere**, since there's no checkout to have a HEAD.
- **Never offer rendering or notes here.** `hostedReviewSource` answers `read-only`, and the client leaves them out, since they belong to a person's own machine (**Scope: remote-notes** in `docs/specs/feedback.md`).
- **Must show someone signed out everything but the controls that decide**, in their place a link to sign in.

## Without Git or a decoder

Source of truth: `ui/src/server/hosted.ts`, `RenderBatches.compareReached` and `recordCommits` in `store/src/core/render-batches.ts`, `StoredDiffs` in `store/src/core/stored-diffs.ts`; `uploadCommits` and `uploadDiffs` in `cli/src/sync.ts`.

- **Must learn what a commit reaches from `commit_parents`, which a push fills from `git rev-list --parents`**, walked in SQL, through every parent, up to 1,000 commits, so what history reaches means here what it means locally (`docs/specs/renders.md` → Approvals), but for the commits of a branch's earlier batches, which aren't followed yet (rationale).
- **Must be told a pair's diff by whoever pushed, who has to fetch what it's compared with to work it out**, since a Worker can't decode an image (rationale). **A pair with no diff shows its images with no highlight**, as when a later approval changed what a batch is compared with.
- **Must take a built Storybook's files, and only what's missing**, then write its row last, as `docs/specs/store.md` → Built Storybooks says.

## Commit status

Source of truth: `commitStatusOf` in `ui/src/shared/commit-status.ts`, `publish` and `publishDecided` in `ui/src/worker/app.ts`, `RenderBatches.compareWithBaseReached` and `RenderBatches.batchesReaching` in `store/src/core/render-batches.ts`, `.github/actions/selfie/action.yml`.

| State | When | Says, for example |
|---|---|---|
| `failure`, red | A story failed, or a person rejected a change, so someone has to change the code | "1 story failed, 1 change rejected" |
| `pending`, yellow | Something is changed, added, or removed with no decision, so a writer has to look | "21 changed, 11 added, waiting for approval"; on a branch, "Changes nothing from main; 32 inherited changes wait for approval" or "3 changed by this branch, and 29 inherited from main, waiting for approval" |
| `success`, green | Every story matches what its history approved | "145 stories match what's approved" |

- **Must post one status per commit, in the context `selfie`, linking to its batch's page.**
- **Must post it from the newest finished batch at that commit, at the end of a push and on every decision made here, after answering**, so nobody waits on GitHub to see their decision.
- **Must tell apart, in a yellow status, what a commit's branch changed from what it inherited**, unless the commit has a batch of the default branch or its batch has no base (`docs/specs/renders.md` → Approved since a base), when it counts each state alone (rationale). A story waiting for approval is inherited when the base has the very same image, or, for a removal, lacks it too, and the branch's own otherwise. The state and what blocks never depend on it.
- **Must keep a description within GitHub's 140 characters**, naming the default branch as "the default branch" if its own name would go past them.
- **Must, on a decision made here, after its own commit's, post it again for each later commit whose history reaches that commit, by `commit_parents`, and has a finished batch in the same environment**, so a stack of pull requests turns green when one low in it is approved (rationale). It walks up to 1,000 commits from the decided one, as [Without Git or a decoder](#without-git-or-a-decoder) does the other way, and posts at most 50 of these, newest batch first. **May post a state a commit already has.** A later commit beyond those keeps its status until its next push, or a decision on it.
- **Must keep a decision if GitHub can't take its status**, and log why, and go on to the next commit. The next decision or push says it again.
- **Must leave a repository's own tools alone in that action**, installing Selfie's dependencies with its own pnpm, since a repository may pin another for its build.
- **Must render on every pushed branch, through `.github/actions/selfie` on an arm64 runner, with all of a commit's history**, so what's pinned matches (`docs/specs/render.md`) and what it reaches is known. A failed story is a result the status says, and only a push that fails fails the job.
- **Never make a commit's status required from here.** Whether `selfie` blocks a merge is the repository owner's choice, in branch protection.

## Future

- A status saying a commit is still rendering, between a push and its batch. Until then a commit has no `selfie` status for those minutes.
- Following a branch's earlier batches, so a force-push keeps the approvals its old commits had. Until then it asks again.
- A status on a fork's pull request, which gets no upload token (`docs/specs/access.md` → Pull requests from forks).
- A list of a project's commits and batches.
- A project's own `hunkMergeDistance`, since nothing here reads its config. Hunks group at the default of 12.
- Rate limits on anonymous requests (`docs/specs/access.md` → Serving images).
- More people, which is **Scope: github-access** (`docs/specs/access.md` → Future).
