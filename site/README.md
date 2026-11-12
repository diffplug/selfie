# selfie.dev

The landing page for [Selfie](https://github.com/diffplug/selfie), distributed Storybook testing.

> Looking for the JVM/Python snapshot testing library (`expectSelfie`, `expect_selfie`)? It moved to [diffplug/selfie-lib](https://github.com/diffplug/selfie-lib), with docs at [lib.selfie.dev](https://lib.selfie.dev).

It's plain HTML and CSS in `public/`, with no build step, hosted on Cloudflare Pages.

```sh
pnpm install
pnpm dev     # serves public/ the way Pages does, including _redirects and 404.html, on every interface so phones can reach it
pnpm test    # checks the redirects, the links, and the 404 against that server
```

## Redirects

[`public/_redirects`](public/_redirects) comes from [diffplug/selfie#26](https://github.com/diffplug/selfie/issues/26). Released jars and wheels link to these paths and can't be changed, so the redirects are permanent. **Don't reuse `/jvm`, `/py`, `/demo-gif`, `/go`, `/other-platforms`, or `/js` for anything on this site.**

## Deploying

`selfie.dev` is the `selfie-landing` Pages project. `.github/workflows/site.yml` tests and publishes it from `main`; see [OPERATIONS.md](../OPERATIONS.md). After a deploy, `BASE_URL=https://selfie.dev pnpm test` checks the real thing.

## Licenses

The video thumbnails come from the hackathon videos in [`demo-video/`](../demo-video/) and [`product-demo/`](../product-demo/), and [`branding/`](../branding/) is under Apache-2.0 ([LICENSE-branding](LICENSE-branding)). The icon is new. The hero's robot was generated with Codex's image tool; its sources and the script that cuts it into layers are in [`art/`](art/README.md). Jost and Neucha are under OFL-1.1.
