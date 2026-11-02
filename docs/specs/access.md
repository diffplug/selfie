# Access

> Status: design — nothing here is implemented yet.
>
> - See `docs/specs/glossary.md` for project, image, and store.
> - Owns the GitHub App, who can see and change a project, and how images are served. Where account data lives belongs to `docs/specs/system.md` → Cloud data; how bytes are stored belongs to `docs/specs/store.md`.

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
- **Must rate-limit anonymous requests**, since anyone can make them and each one costs an R2 read.

### Signing in

- **Must sign browsers in through the GitHub App's web application flow.**
- **Must sign the CLI in through the GitHub App's device flow**, which is an opt-in setting on the app.
- **Must not need a login to view a public repository.**

### Local review server

- **Must listen only on loopback and check the `Host` header**, so a website the user visits can't read their snapshots through it.

### Open questions

- **Unpushed work in public repositories.** A run uploaded from an unpushed branch of a public repository would be visible to anyone. Decide whether anonymous viewers see only runs for commits GitHub already has, or whether a run isn't uploaded until its commit is pushed.
- **CI uploads.** GitHub Actions OIDC carries `repository_id`, so CI may need no stored secret. Confirm how to verify the token, and what a pull request from a fork receives.
- **Pull requests from forks.** Someone without write access can't upload under the table above, so decide how a fork's pull request gets snapshots.
- **Reading code for `change-grouping`.** That scope sends code diffs to a Meta model, which needs more app permissions and means private code leaves GitHub. Decide how a repository owner consents.
