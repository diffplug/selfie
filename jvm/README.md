# Selfie snapshot testing for Java, Kotlin, and the JVM

- [Quickstart](https://selfie.dev/jvm/get-started)
- [Advanced](https://selfie.dev/jvm/advanced)
- [Why selfie](https://selfie.dev/jvm)

## Contributing

PR's welcome! It's a standard Gradle build, with one important hiccup!

If you clone this project and run `./gradlew build`, it will fail.

If you instead run `./gradlew testKotest`, and then `./gradlew build`, it will pass. This is what we do in CI. This is bad, we are trying to fix it ([#203](https://github.com/diffplug/selfie/issues/203)).

One tricky thing is that testing inline snapshots requires changing the code being tested. To make this work, we have `undertest` projects. Their `test` task is disabled, and they have an `underTest` task instead. You'll note that every test in these projects is named `UT_SomethingTest`. That's because there is a corresponding `SomethingTest` in `selfie-runner-junit5` , and `SomethingTest` works by changing the source code in `UT_SomethingTest`, running builds, and making assertions about the state of snapshots and source code after the build.
