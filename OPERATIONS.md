# Operations

Selfie has two deployments, both in Cloudflare account `0a95e814ccf2b6a95d2dc3bea0a4a2b4`:

| What | Where | Source | Deployed by |
|---|---|---|---|
| The landing page | `selfie.dev`, Pages project `selfie-landing` | `site/` | `.github/workflows/site.yml`, on every push to `main` that touches `site/` |
| The app | `app.selfie.dev`, Worker `selfie-app`, with built Storybooks on `selfieusercontent.com` and a redirect from `hackathon.selfie.dev` | `ui/`, `store/` | `.github/workflows/app-production.yml`, run by hand with **promote** |

`lib.selfie.dev`, `kdoc.selfie.dev`, and `pydoc.selfie.dev` belong to the earlier library ([diffplug/selfie-lib](https://github.com/diffplug/selfie-lib)), on their own Pages projects. Never move them here.

The app keeps its data in three places:

- **D1:** one database per project, `selfie-project-<repository id>`, bound in `ui/wrangler.toml`. A project sets up its own schema on first use.
- **R2:** bucket `selfie-hackathon-images`, named for the hackathon, since R2 can't rename a bucket.
- **Postgres on Neon:** sign-in only, through pgstencil, reached by the Worker through an uncached Hyperdrive. Its schema is `@pgstencil/auth`'s migrations, listed in `ui/pgstencil.json`.

## Releasing

- **The site:** merge to `main`. The workflow tests the site locally, publishes `site/public/`, and tests `https://selfie.dev`.
- **The app:** every push to `main` that touches the app runs its tests. To release, run **App production release** from the Actions tab on `main`, with **promote** checked. It checks the Hyperdrive and the Worker's secrets, applies sign-in's migrations, deploys, and then checks the live origins with `ui/scripts/production.mjs smoke`. Migrations are append-only and run before the new Worker serves, so the Worker that's live during a release must work with the new schema.

From a laptop, the same steps are `node ui/scripts/production.mjs preflight|deploy|smoke`, with the environment the workflow sets.

## Logs

`selfie-app` keeps what it logs in Workers Logs (`[observability]` in `ui/wrangler.toml`), for 3 days on the Workers Free plan and 7 on Paid: in the dashboard, **Workers & Pages → selfie-app → Logs**. It doesn't keep a line for every request, only what the code logs, which is mostly errors.

Every error a person sees comes with an error code, such as `Error code: 7K3MQ9XP`, and its log line starts `Error 7K3MQ9XP:`. To find it, search the logs for the code. A server error's line has the error and its stack. To watch live instead, `pnpm --dir ui exec wrangler tail selfie-app`.

## Secrets and settings

GitHub environment `app-production`, limited to the `main` branch:

| Name | Kind | What |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | The deploy token, below |
| `DATABASE_URL` | secret | The Neon migration role's direct URL (not the pooler, and not Hyperdrive) |
| `HYPERDRIVE_ID` | variable | The Hyperdrive the Worker reaches Postgres through |

Repository-wide:

| Name | Kind | What |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | variable | `0a95e814ccf2b6a95d2dc3bea0a4a2b4` |
| `CLOUDFLARE_PAGES_TOKEN` | secret | Account `0a95e814…`: Cloudflare Pages Edit, and nothing else |
| `SELFIE_UPLOAD_TOKEN` | secret | What this repository's own CI uploads with, as on every repository the app hosts |

The two Cloudflare tokens are kept nowhere else. To rotate one, create a token with the same permissions, set it with `pbpaste | gh secret set …`, and delete the old one.

The deploy token holds exactly: Workers Scripts Edit, Account Settings Read, Hyperdrive Read, and D1 Read on the account, and Workers Routes Edit, DNS Edit, and Zone Read on `selfie.dev` and `selfieusercontent.com`. The Pages token holds Pages Edit.

Worker secrets on `selfie-app`, set with `pnpm --dir ui exec wrangler secret put <NAME>`, which `preflight` checks are all there. Cloudflare can't show them again, so keep each in the password manager:

| Name | What |
|---|---|
| `AUTH_SECRET` | 32 or more random characters, for pgstencil's cookies and keys; changing it signs everyone out |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The GitHub App's OAuth client, for signing in |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | The GitHub App itself, for commit statuses and reading code |
| `SELFIE_UPLOAD_TOKEN` | CI's bearer token: uploads, and can't decide anything |
| `SELFIE_WRITER_TOKEN` | The writer's bearer token, for `SELFIE_TOKEN` in their own `selfie push`, `pull`, and `approve` |
| `MODEL_API_KEY` | The Meta Model API key for chat |

## Setting up from nothing

Done once, in this order.

### 1. GitHub

1. Rename `diffplug/selfie-hackathon` to `diffplug/selfie`. GitHub then redirects the old name, and the Worker answers it too (`docs/specs/cloud.md` → Projects). Update local checkouts with `git remote set-url origin https://github.com/diffplug/selfie`, and point other repositories' workflows at `diffplug/selfie/.github/actions/selfie@main`.
2. In the GitHub App's settings (**Selfie.dev**, `github.com/apps/selfie-dev`, App ID `5607634`; "Selfie" alone is reserved by GitHub), then under **Identifying and authorizing users**:
   - set the **Callback URL** to exactly `https://app.selfie.dev/api/auth/callback/github`
   - leave **Request user authorization (OAuth) during installation** off
   - generate a **client secret**; it and the app's **Client ID** are `GITHUB_CLIENT_SECRET` and `GITHUB_CLIENT_ID`

   Its permissions are `statuses: write` and `contents: read` on repositories, **Email addresses: Read-only** on accounts, and no webhook. Without the email permission, GitHub refuses pgstencil's read of `/user/emails`, and every sign-in fails with a 500.
3. Create the `app-production` environment, limited to `main`, and set the secrets and variables above.

### 2. Neon

1. Create a project `selfie` on PostgreSQL 18, with a database `selfie`, and turn on point-in-time restore. Keep it apart from Dormouse's.
2. Its owner role is the migration role: put its direct URL in `DATABASE_URL`, then apply the schema once: `DATABASE_URL=… pnpm --dir ui db:migrate`, and `db:validate`.
3. Create the runtime role, `selfie_app`, with only the DML sign-in's tables need, by `ui/scripts/runtime-role.mjs` as the owner. It runs SQL over the encrypted connection, since Neon's console would give the role `neon_superuser`. It takes both values from the environment, and running it again sets a new password:

   ```sh
   DATABASE_URL=… SELFIE_APP_PASSWORD="$(openssl rand -hex 24)" node ui/scripts/runtime-role.mjs
   ```

### 3. Cloudflare

1. Add `selfieusercontent.com` as a zone, and point its registrar's nameservers at Cloudflare.
2. Create the Hyperdrive as `selfie_app`, with caching off, since a sign-out must be seen at once:

   ```sh
   pnpm --dir ui exec wrangler hyperdrive create selfie-auth --caching-disabled --connection-string='postgres://selfie_app:…@<neon host>/selfie?sslmode=require'
   ```

   Use Neon's direct host, not its `-pooler` one, since Hyperdrive pools. Its ID is `HYPERDRIVE_ID`. `ui/wrangler.toml` keeps a placeholder, which `deploy` replaces.
3. Set every Worker secret above on `selfie-app`. Copy `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `SELFIE_UPLOAD_TOKEN`, and `MODEL_API_KEY` from the hackathon's Worker's entries in the password manager. Generate `AUTH_SECRET` and `SELFIE_WRITER_TOKEN` fresh, with `openssl rand -hex 32`.
4. Create the two API tokens above.

### 4. Moving off the hackathon's Worker

The hackathon's Worker, `selfie-hackathon`, holds `hackathon.selfie.dev` as a custom domain, and `selfie-app` claims it.

1. In the dashboard, remove `hackathon.selfie.dev` from `selfie-hackathon`'s domains. The old URL is down until the next step finishes.
2. Run **App production release** with **promote**. Its smoke checks cover the new origins, the redirect, and starting a sign-in.
3. Sign in at `https://app.selfie.dev/sign-in`, and check a project page says you can approve.
4. Push a commit, and check its `selfie` status links to `app.selfie.dev`.
5. Delete the `selfie-hackathon` Worker. Its D1 databases and R2 bucket are `selfie-app`'s now, so delete only the Worker.
