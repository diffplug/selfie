# Access

> Status: partly built — the [local review server](#local-review-server) is built; everything under `## Future` is design.
>
> - See `docs/specs/glossary.md` for project, image, and store.
> - Owns the GitHub App, who can see and change a project, and how images are served. Where account data lives belongs to `docs/specs/system.md` → Cloud data; how bytes are stored belongs to `docs/specs/store.md`.

## Local review server

Source of truth: `loopbackHosts` in `ui/src/server/local.ts`, and `sameOriginWrites` and `pageHeaders` in `ui/src/server/app.ts`, which any deployment keeps; tests in `cli/test/ui.test.ts`. `docs/specs/ui.md` owns the routes.

There's no login on this server, since anyone who can reach loopback on the machine already has the store's files.

- **Must listen only on loopback and check the `Host` header**, so a website the user visits can't read their snapshots through it, by pointing its own DNS name at `127.0.0.1` for one (rationale). The header must be `127.0.0.1:<port>` or `localhost:<port>`, with the port it is listening on, and anything else gets 403.
- **Must refuse a request whose `Origin` isn't this server's**, whatever its method.
- **Must require `Content-Type: application/json` and the header `X-Selfie-Request: review-ui` on anything but GET and HEAD**, so a form or a page on another site can't approve anything, and must send no CORS headers, so a page's own attempt fails its preflight (rationale).
- **Must refuse to be framed and to be embedded**, with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and `Cross-Origin-Resource-Policy: same-origin`, so another site can't steer a click on Approve (rationale), on every response, refusals included. `Content-Security-Policy` is exactly `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, through `hono/secure-headers`.
- **Must host a Storybook on a loopback port of its own, read only, never on the review server's origin**, since its code is whatever branch was built, and on that origin it could approve its own images (rationale). The `Host` check applies to it too. It may be framed only by itself, since Storybook frames its own preview, and it serves nothing from a directory with no `iframe.html`.
- **Must serve an image only through the app, by a validated hash, with `Cache-Control: private`**, and never name a file path in a response. Reserved: [Serving images](#serving-images) holds the same for the cloud.

## Future

**Scope: github-access**

### GitHub App

- **Must integrate with GitHub through one GitHub App, never an OAuth app or personal access tokens.**
- **Must create a project only for a repository the app is installed on.** A project exists because a repository owner chose to install the app.
- **Must identify a project by its repository's numeric ID, never its owner or name**, so a rename or transfer keeps the project, and recreating a name can't inherit another repository's snapshots (rationale). The ID is the project identifier in `docs/specs/store.md` → R2 adapter.
- **Must request only the permissions a built scope uses**, starting from what repository access checks need, since a repository owner approves every permission at install.
- **Must keep the app's private key, client secret, and webhook secret only in Worker secrets**, and users' GitHub tokens only on the server, never in the browser.
- **Must verify every webhook's signature before acting on it.**

### Who can do what

GitHub decides. Selfie keeps no member list of its own.

| Action | Public repository | Private repository |
|---|---|---|
| View images, runs, and reviews | Anyone, with no login | Anyone with read access on GitHub |
| Approve or reject changes | Write access | Write access |
| Upload runs | Write access | Write access |

- **Must decide from the repository's `permissions` and `private` fields as GitHub reports them**, using the user's token for a signed-in user and an installation token for an anonymous viewer (rationale).
- **Never let an anonymous viewer change anything.**
- **Must apply a repository's current visibility to all its snapshots, past ones included**, so a repository going public makes its earlier snapshots public, as it does its Git history, and going private hides them all again.
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
- **Must accept an OIDC token only for uploading to its own repository's project**, never to view a private project, approve, or reject, since it identifies a workflow and not a person. Uploading includes making goldens that remove nothing, since that approves nothing (`docs/specs/sync.md` → Goldens).

### Pull requests from forks

- **Must give a fork's pull request only what read access gives**: its author can read the repository's snapshots as anyone with read access can, and can't upload or approve.
- **Must fail a fork's pull request's snapshot check until a maintainer approves running the capture pass.** Nothing from the fork is stored before that.

**Later:** a fork's pull request could keep its changed snapshots somewhere like Actions artifacts until a maintainer accepts them.

### Open questions

A run isn't uploaded until GitHub has its commit (`docs/specs/sync.md` → What goes), so anonymous viewers see no unpushed work.

- **Running an approved capture pass.** Decide how a maintainer approves it and how it runs, since it executes the fork's code and needs a token to upload. GitHub's docs don't say whether a fork's `pull_request` run can get an OIDC token, and `pull_request_target` runs with write access even from a public fork, so both need testing. The fork's code could forge its screenshots, so its run must stay subject to normal approval. It would also be the one uploader without write access, so it must not reach the project's images through the route that takes a client's hash on trust: it could plant a false picture under the hash of an image that hasn't been rendered yet.
- **Reading code for `change-grouping`.** That scope sends code diffs to a Meta model, which needs more app permissions and means private code leaves GitHub. Decide how a repository owner consents.
