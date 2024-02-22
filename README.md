# Selfie: snapshot testing and [memoizing](https://selfie.dev/jvm/cache) for Java, Kotlin, and the JVM

![gif demo of selfie in action](https://docs.diffplug.com/selfie/selfie-demo.gif)

## Key features

- Just [add a test dependency](https://selfie.dev/jvm/get-started#installation), zero setup, zero config.
- Snapshots can be [inline literals](https://selfie.dev/jvm#literal) or [on disk](https://selfie.dev/jvm#like-a-filesystem).
- Use `expectSelfie` for testing or `cacheSelfie` for [memoizing expensive API calls](https://selfie.dev/jvm/cache).
- Disk snapshots are automatically [garbage collected](https://github.com/diffplug/selfie/blob/main/jvm/selfie-runner-junit5/src/main/kotlin/com/diffplug/selfie/junit5/SelfieGC.kt) when the test class or test method is removed.
- Snapshots are **just strings**. Use html, json, markdown, whatever. No [magic serializers](https://selfie.dev/jvm/facets#typed-snapshots).
- Record **multiple facets** of the entity under test, e.g. for a web request...
  - store the HTML as one facet
  - store HTML-rendered-to-markdown as another facet
  - store cookies in another facet
  - **assert some facets on disk, others inline**
  - see gif above for live demo, detailed example [here](https://selfie.dev/jvm/advanced)

JVM only for now, [python](https://github.com/diffplug/selfie/issues/170) is in progress, other platforms on the way: [js](https://github.com/diffplug/selfie/issues/84), [.NET, go, ...](https://github.com/diffplug/selfie/issues/85)

## Documentation

- [Installation](https://selfie.dev/jvm/get-started#installation)
- [Quickstart](https://selfie.dev/jvm/get-started#quickstart)
- [Facets](https://selfie.dev/jvm/facets)
- [Caching / memoizing](https://selfie.dev/jvm/cache)
- [Why selfie](https://selfie.dev/jvm)
- [API reference](https://kdoc.selfie.dev/)

## Contributing

PRs welcome! Horror stories and glory stories too, share your experience! See [`CONTRIBUTING.md`](CONTRIBUTING.md).


## Acknowledgements

Heavily inspired by [origin-energy's java-snapshot-testing](https://github.com/origin-energy/java-snapshot-testing), which in turn is heavily inspired by [Facebook's jest-snapshot](https://jestjs.io/docs/snapshot-testing).
