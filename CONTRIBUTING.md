# Contributing to Selfie

- If you want to improve our webpage, [selfie.dev](https://selfie.dev), go to [`docs/README.md`](docs/README.md)
- If you want to remove the webpage of our published kdoc, [kdoc.selfie.dev](https://kdoc.selfie.dev), go to [`gradle/dokka/README.md`](gradle/dokka/README.md)
- If you want to contribute to the Kotlin Multiplatform implementation of selfie (jvm, js, wasm) use the gradle instructions below
- If you want to contribute for a different platform (python, go, etc.) we'd love to help, but it should probably live in a different repo. Discuss in [selfie#85](https://github.com/diffplug/selfie/issues/85), but also feel free to open a PR with any ideas you have.


Pull requests are very welcome, preferably against `main`.

## Build instructions

It's a standard Gradle build, `./gradlew build` to assemble and test everything.

One tricky thing is that inline snapshots requires changing the code being tested. To make this work, we  have `undertest` projects. Their `test` task is disabled, and they have an `underTest` task instead. You'll note that every test in these projects is named `UT_SomethingTest`. That's because there is a corresponding `SomethingTest` in `selfie-runner-junit5` , and `SomethingTest` works by changing the source code in `UT_SomethingTest`, running builds, and making assertions about the state of snapshots and source code after the build.

## License

By contributing your code, you agree to license your contribution under the terms of the APLv2: https://github.com/diffplug/atplug/blob/master/LICENSE

All files are released with the Apache 2.0 license as such:

```
Copyright 2023-2024 DiffPlug

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
