This gets deployed to [kdoc.selfie.dev](https://kdoc.selfie.dev) by [this CI script](https://github.com/diffplug/selfie/blob/main/.github/workflows/jvm-publish-kdoc.yml) which runs on every push to `release`.

Full info is available at https://kotlinlang.org/docs/dokka-html.html

But the gist is that [this folder](https://github.com/Kotlin/dokka/tree/master/plugins/base/src/main/resources/dokka) has

- images (mainly `logo-icon.svg`)
- styles (`style.css`, `prism.css` (syntax highlighting), `logo-styles.css`)
- templates (`base.ftl`, `header.ftl`, `footer.ftl`)

And we can override any of them in the root `build.gradle` inside the `dokkatoo` blocks.
