# Selfie: snapshot testing for Java, Kotlin, and the JVM

![gif demo of selfie in action](https://docs.diffplug.com/selfie/selfie-demo.gif)

## Key features

- Just [add a test dependency](https://selfie.dev/jvm/get-started#installation), zero setup, zero config.
- Snapshots can be [inline literals](https://selfie.dev/jvm#literal) or [on disk](https://selfie.dev/jvm#like-a-filesystem).
- Disk snapshots are automatically [garbage collected](https://github.com/diffplug/selfie/blob/main/jvm/selfie-runner-junit5/src/main/kotlin/com/diffplug/selfie/junit5/SelfieGC.kt) when the test class or test method is removed.
- Snapshots are **just strings**. Use html, json, markdown, whatever. No [magic serializers](https://selfie.dev/jvm/advanced#typed-snapshots).
- Record **multiple facets** of the entity under test, e.g. for a web request...
  - store the HTML as one facet
  - store HTML-rendered-to-markdown as another facet
  - store cookies in another facet
  - **assert some facets on disk, others inline**
  - see gif above for live demo, detailed example [here](https://selfie.dev/jvm/advanced)

JVM only for now, other platforms on the way: [js](https://github.com/diffplug/selfie/issues/84), [py, go, ...](https://github.com/diffplug/selfie/issues/85)

## Documentation

- [Installation](https://selfie.dev/jvm/get-started#installation)
- [Quickstart](https://selfie.dev/jvm/get-started#quickstart)
- [Advanced usage](https://selfie.dev/jvm/advanced)
- [API reference](https://kdoc.selfie.dev/)


## Contributing

PRs welcome! Horror stories and glory stories too, share your experience! See [`CONTRIBUTING.md`](CONTRIBUTING.md).


## Acknowledgements

Heavily inspired by [origin-energy's java-snapshot-testing](https://github.com/origin-energy/java-snapshot-testing), which in turn is heavily inspired by [Facebook's jest-snapshot](https://jestjs.io/docs/snapshot-testing).
