# Access

> Status: partly built — the [local review server](#local-review-server) and [one writer's public projects](#who-can-do-what) are built; everything under `## Future` is design.
>
> - See `docs/specs/glossary.md` for project, image, and store.
> - Owns the GitHub App, who can see and change a project, and how images are served. Where account data lives belongs to `docs/specs/system.md` → Cloud data; how bytes are stored belongs to `docs/specs/store.md`.

## Local review server

Source of truth: `loopbackHosts` in `ui/src/server/local.ts`, and `sameOriginWrites` and `pageHeaders` in `ui/src/server/app.ts`, which any deployment keeps; tests in `cli/test/ui-*.test.ts`. `docs/specs/ui.md` owns the routes.

There's no login on this server, since anyone who can reach loopback on the machine already has the store's files.

- **Must listen only on loopback and check the `Host` header**, so a website the user visits can't read their renders through it, by pointing its own DNS name at `127.0.0.1` for one (rationale). The header must be `127.0.0.1:<port>` or `localhost:<port>`, with the port it is listening on, and anything else gets 403.
- **Must refuse a request whose `Origin` isn't this server's**, whatever its method.
- **Must require `Content-Type: application/json` and the header `X-Selfie-Request: review-ui` on anything but GET and HEAD**, so a form or a page on another site can't approve anything, and must send no CORS headers, so a page's own attempt fails its preflight (rationale).
- **Must refuse to be framed and to be embedded**, with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and `Cross-Origin-Resource-Policy: same-origin`, so another site can't steer a click on Approve (rationale), on every response, refusals included. `Content-Security-Policy` is exactly `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, with `frame-src` naming the hosted Storybook's origin if there is one, through `hono/secure-headers`.
- **Must host a Storybook on a loopback port of its own, read only, never on the review server's origin**, since its code is whatever branch was built, and on that origin it could approve its own images (rationale). The `Host` check applies to it too. It may be framed only by itself, since Storybook frames its own preview, and by the review page, and it serves nothing from a directory with no `iframe.html`. Kept built Storybooks share that origin (`docs/specs/ui.md` → Routes).
- **Must let the review page frame only the hosted Storybook's origin, and sandbox every frame, without `allow-top-navigation`**, so a story can't steer the review page, and can't read it, being another origin (rationale).
- **Must serve an image only through the app, by a validated hash, with `Cache-Control: private`**, and never name a file path in a response. Reserved: [Serving images](#serving-images) holds the same for the cloud.

## Who can do what

Source of truth: `ui/src/worker/auth.ts`, `accessOf` in `ui/src/worker/app.ts`, `ui/src/worker/github.ts`; tests in `ui/test/workerd/cloud.workerd.test.ts`. `docs/specs/cloud.md` says what the Worker hosts.

Every project here is public, and one person writes (rationale).

| Who | How they're known | View | Upload | Approve or reject |
|---|---|---|---|---|
| Anyone | Nothing | Yes | No | No |
| CI | `SELFIE_UPLOAD_TOKEN`, a repository secret and a Worker secret, as a bearer token | Yes | Yes | No |
| The writer, `nedtwigg` | `SELFIE_WRITER_PASSWORD`, a Worker secret: as a bearer token, or through `/sign-in` for a cookie | Yes | Yes | Yes |

- **Must keep the password and the upload token only in Worker secrets, and compare them by digest**, so how long a comparison takes says nothing of a guess.
- **Must sign a session cookie with the password, so that changing it signs everyone out, and name it `__Host-` with `HttpOnly`, `Secure`, and `SameSite=Strict`**, for 30 days.
- **Must refuse a sign-in from another site, and send a person only to a path on this site after signing in.**
- **Must keep `sameOriginWrites` and `pageHeaders` on the review routes.** The sync routes answer only to a bearer token, and never read the cookie.
- **Must use one GitHub App, Selfie Hackathon, with only `statuses: write` and `contents: read`, and no webhook**, to say whether a repository has a commit and to post a commit's status. **Its private key stays in Worker secrets.**
- **Must refuse a commit GitHub doesn't have**, as `docs/specs/sync.md` → What goes says, and treat any other answer from GitHub as an error.

## Future

**Scope: github-access** replaces the password with what follows, for a service with other people or private repositories on it.

### GitHub App

- **Must integrate with GitHub through one GitHub App, never an OAuth app or personal access tokens.**
- **Must create a project only for a repository the app is installed on.** A project exists because a repository owner chose to install the app.
- **Must identify a project by its repository's numeric ID, never its owner or name**, so a rename or transfer keeps the project, and recreating a name can't inherit another repository's renders (rationale). The ID is the project identifier in `docs/specs/store.md` → R2 adapter.
- **Must request only the permissions a built scope uses**, starting from what repository access checks need, since a repository owner approves every permission at install.
- **Must keep the app's private key, client secret, and webhook secret only in Worker secrets**, and users' GitHub tokens only on the server, never in the browser.
- **Must verify every webhook's signature before acting on it.**

### Who can do what

GitHub decides. Selfie keeps no member list of its own.

| Action | Public repository | Private repository |
|---|---|---|
| View images, batches, and reviews | Anyone, with no login | Anyone with read access on GitHub |
| Approve or reject changes | Write access | Write access |
| Upload batches | Write access | Write access |

- **Must decide from the repository's `permissions` and `private` fields as GitHub reports them**, using the user's token for a signed-in user and an installation token for an anonymous viewer (rationale).
- **Never let an anonymous viewer change anything.**
- **Must apply a repository's current visibility to all its renders, past ones included**, so a repository going public makes its earlier renders public, as it does its Git history, and going private hides them all again.
- **Must fail closed.** If GitHub can't answer, a private repository's data is refused, and a repository not known to be public counts as private.
- **Must answer 404 to someone without access, identical to a project that doesn't exist**, so a response never reveals that a private repository uses Selfie.
- **May cache an access answer for at most 5 minutes**, and must drop it on any webhook about that repository, so a review page's many images don't each ask GitHub. Webhooks only shorten the window, since they don't cover every change (rationale).

### Serving images

- **Never give an image a direct R2 URL.** Every image is served by the Worker after an access check. The bucket's `r2.dev` access and custom domains stay off, and it issues no presigned URLs.
- **Never treat an image hash as a secret**, since anyone holding an image can compute it. Access depends on who is asking and which project they ask about.
- **Must serve images with `Cache-Control: private`, for public repositories too**, since a repository can become private and a shared cache would keep serving it.
- **Must serve images with `X-Content-Type-Options: nosniff`, and a type read from their first bytes**, since the cloud doesn't read a file's body (`docs/specs/sync.md` → What a store takes).
- **Must rate-limit anonymous requests**, since anyone can make them and each one costs an R2 read.

### Signing in

- **Must sign browsers in through the GitHub App's web application flow.**
- **Must sign the CLI in through the GitHub App's device flow**, which is an opt-in setting on the app.
- **Must not need a login to view a public repository.**

### CI uploads

- **Must authenticate CI uploads with GitHub Actions OIDC, so a repository stores no Selfie secret.**
- **Must verify every OIDC token before accepting it:** an RS256 signature from GitHub's published keys, the issuer `https://token.actions.githubusercontent.com`, an unexpired token, an audience naming Selfie, and a `repository_id` that is the project being uploaded to (rationale). A token for any other audience was meant for another service.
- **Must accept an OIDC token only for uploading to its own repository's project**, never to view a private project, approve, or reject, since it identifies a workflow and not a person.

### Pull requests from forks

- **Must give a fork's pull request only what read access gives**: its author can read the repository's renders as anyone with read access can, and can't upload or approve.
- **Must fail a fork's pull request's render check until a maintainer approves running the render pass.** Nothing from the fork is stored before that.

**Later:** a fork's pull request could keep its changed renders somewhere like Actions artifacts until a maintainer accepts them.

### Open questions

A batch isn't uploaded until GitHub has its commit (`docs/specs/sync.md` → What goes), so anonymous viewers see no unpushed work.

- **Running an approved render pass.** Decide how a maintainer approves it and how it runs, since it executes the fork's code and needs a token to upload. GitHub's docs don't say whether a fork's `pull_request` batch can get an OIDC token, and `pull_request_target` runs with write access even from a public fork, so both need testing. The fork's code could forge its screenshots, so its batch must stay subject to normal approval. It would also be the one uploader without write access, so it must not reach the project's images through the route that takes a client's hash on trust: it could plant a false picture under the hash of an image that hasn't been rendered yet.
- **Reading code for `change-grouping`.** That scope sends code diffs to a Meta model, which needs more app permissions and means private code leaves GitHub. Decide how a repository owner consents.
