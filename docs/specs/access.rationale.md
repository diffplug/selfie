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

## Local review server

- **Why `Host`, on top of loopback.** A site can make its own name resolve to `127.0.0.1` after the browser has loaded its page. The browser then treats requests to the server as same-origin with that site, and sends that site's name as `Host`. Loopback alone doesn't stop that, and this check does.
- **Why both a custom header and JSON.** A form can send neither, and a page's `fetch` can only send them after a preflight, which this server never answers with CORS headers. `Origin` then covers a client that does send them from another site. Checked by `cli/test/ui-*.test.ts` with a foreign `Origin` plus the header and the type, and with each form content type.
- **Why a Storybook gets its own origin.** A page's scripts can send everything `sameOriginWrites` asks for from that origin, custom header included, so only a different origin keeps a story away from Approve. A port is enough: the browser refuses the review API's responses to any other, and the server refuses its `Origin`. It can't be held to the review page's CSP instead, since Storybook runs inline scripts.
- **Why frames are safe here.** A frame on another origin can't read the page or call the review API as it, and the sandbox stops it navigating the page away. `allow-same-origin` only keeps it on its own origin, where Storybook's preview needs its storage, and it can't lift the sandbox from there, since it isn't the page's origin.
- **Why refuse framing.** Without it, a site could put the page in an invisible frame and steer a click onto Approve, and every check above would pass.

## Who can do what

**One writer, by password.** The service holds only public repositories, and only their owner reviews them, so sign-in through GitHub would be a client secret, a callback, and a token store to say what's already known. It's also what lets a writer sign in without the service ever holding a GitHub token. **Scope: github-access** is what it takes for that to stop being true.

**An upload token rather than OIDC.** It's a secret a repository has to hold, which OIDC avoids, and it costs a rotation if it leaks. A leak lets someone upload to a public project, which can't approve anything, and can only add batches at commits GitHub has.
