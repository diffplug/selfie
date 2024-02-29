This page gets built with `npm run build` and deployed to [https://selfie.dev](https://selfie.dev) via CloudFlare, which is deploying the `release` branch. A preview will be generated for `selfie.dev/*` branches.

To develop locally, run `npm run dev` and you'll get a local dev server with hotreload.

### Entry points

- JVM homepage, `/jvm` -> [`src/pages/jvm/index.mdx`](src/pages/jvm/index.mdx)
- JVM get started, `/jvm/get-started` -> [`src/pages/jvm/get-started.mdx`](src/pages/jvm/get-started.mdx)
- JVM facets, `/jvm/facets` edit [`src/pages/jvm/facets.mdx`](src/pages/jvm/facets.mdx)
- JVM cache, `/jvm/cache` edit [`src/pages/jvm/cache.mdx`](src/pages/jvm/cache.mdx)

### Deeper interventions

- `src/pages/**` are mdx files which get compiled as markdown with react inside
- `public/` is the images
- [public/_redirects](public/_redirects) sets up cloudflare redirects, including a redirect of `/` to `/jvm`
