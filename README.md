# Selfie: snapshot testing and memoizing for Python, JVM, and [(your PR here)](https://github.com/diffplug/selfie/issues/85)

![gif demo of selfie in action](https://docs.diffplug.com/selfie/selfie-demo.gif)

## Key features

- Just add a test dependency ([py](https://selfie.dev/py/get-started#installation), [jvm](https://selfie.dev/jvm/get-started#installation)), zero setup, zero config.
- Snapshots can be [inline literals](https://selfie.dev/py#literal) or [on disk](https://selfie.dev/py#like-a-filesystem).
- Use `expect_selfie` for testing or `cache_selfie` for [memoizing expensive API calls](https://selfie.dev/py/cache).
- Disk snapshots are automatically [garbage collected](https://github.com/diffplug/selfie/blob/main/jvm/selfie-runner-junit5/src/main/kotlin/com/diffplug/selfie/junit5/SelfieGC.kt) when the test class or test method is removed.
- Snapshots are **just strings**. Use html, json, markdown, whatever. No [magic serializers](https://selfie.dev/py/cache#roundtripping-typed-data).
- Record **multiple facets** of the entity under test, e.g. for a web request...
  - store the HTML as one facet
  - store HTML-rendered-to-markdown as another facet
  - store cookies in another facet
  - **assert some facets on disk, others inline**
  - see gif above for live demo, detailed example [here](https://selfie.dev/py/facets#harmonizing-disk-and-inline-literals)

Python and JVM ports are both production-ready, other platforms on the way: [js](https://github.com/diffplug/selfie/issues/84), [.NET, go, ...](https://github.com/diffplug/selfie/issues/85)

## Documentation

- Quickstart **([py](https://selfie.dev/py/get-started#quickstart), [jvm](https://selfie.dev/jvm/get-started#quickstart))**
- Facets **([py](https://selfie.dev/py/facets), [jvm](https://selfie.dev/jvm/facets))**
- Caching / memoizing **([py](https://selfie.dev/py/cache), [jvm](https://selfie.dev/jvm/cache))**
- Why selfie **([py](https://selfie.dev/py), [jvm](https://selfie.dev/jvm))**
- API reference **([py](https://pydoc.selfie.dev/namespacemembers_func), [jvm](https://kdoc.selfie.dev/))**

## Contributing

PRs welcome! Horror stories and glory stories too, share your experience! See [`CONTRIBUTING.md`](CONTRIBUTING.md).


## Acknowledgements

Heavily inspired by [origin-energy's java-snapshot-testing](https://github.com/origin-energy/java-snapshot-testing), which in turn is heavily inspired by [Facebook's jest-snapshot](https://jestjs.io/docs/snapshot-testing).
