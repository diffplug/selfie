# Access — Rationale

> Informative companion to [access.md](access.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative. GitHub facts come from docs.github.com, read 2026-11.

## GitHub App

**Numeric repository ID.** GitHub's OIDC reference describes `repository_id` as a system-generated ID that doesn't change when a repository is renamed. The pages read don't state this for transfers, so test it before relying on it.

## Who can do what

**User tokens.** A GitHub App's user token reaches only what both the user and the app can access, so a private repository needs the app installed. These tokens expire after 8 hours by default, and their refresh tokens after 6 months.

**Anonymous viewers.** GitHub allows unauthenticated requests 60 per hour per IP, which a Worker's shared addresses would exhaust. An installation token starts at 5,000 per hour.

**Why webhooks can't be the only signal.** GitHub says apps do not receive `repository.deleted`, and `repository.transferred` goes only to the new owner's account if the app is installed there. The pages read don't promise delivery. Collaborator and team events also need an organization permission. So access answers expire on their own, and `privatized` and similar events only shorten the wait.

## CI uploads

**Verification.** GitHub's discovery document at `https://token.actions.githubusercontent.com/.well-known/openid-configuration`, read 2026-11, names that issuer, a `jwks_uri` of `/.well-known/jwks` under it, and RS256 only. Its claims include `repository_id`, `aud`, and `event_name`. By default `aud` is the repository owner's URL, and a workflow sets its own through `core.getIDToken(audience)`. A workflow needs `id-token: write` to request a token. GitHub's docs state no token lifetime, so verification relies on the token's own `exp`.
