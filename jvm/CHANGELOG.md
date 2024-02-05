# Changelog
Changelog for the selfie JVM libraries.

- [`com.diffplug.selfie:selfie-lib:VERSION`](https://central.sonatype.com/artifact/com.diffplug.selfie/selfie-lib)
- [`com.diffplug.selfie:selfie-runner-junit5:VERSION`](https://central.sonatype.com/artifact/com.diffplug.selfie/selfie-runner-junit5)
  - can be used with JUnit4 via [junit-vintage](https://junit.org/junit5/docs/current/user-guide/#migrating-from-junit4)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- `Selfie.later()` for making assertions off of the main thread. ([#198](https://github.com/diffplug/selfie/pull/198))
- `Selfie.withinCoroutine()` for making assertions off of the main thread. ([#198](https://github.com/diffplug/selfie/pull/198))
### Changes
- (no user-facing changes) replaced terrible platform-specific `Path` with `TypedPath`. ([#184](https://github.com/diffplug/selfie/pull/184))
- (no user-facing changes) replaced `SnapshotStorage` with `SnapshotSystem` + `DiskStorage`. ([#198](https://github.com/diffplug/selfie/pull/198))
- (no user-facing changes) replaced all `synchronized` with CAS. ([#199](https://github.com/diffplug/selfie/pull/199))

## [1.1.2] - 2024-01-30
### Fixed
- `@ParameterizedTest` no longer has. ([#140](https://github.com/diffplug/selfie/issues/140))
- If a test class contained package-private methods and a single test method was run without the others, selfie would erroneously garbage collect disk snapshots for the other methods, now fixed. ([#175](https://github.com/diffplug/selfie/pull/175) fixes [#174](https://github.com/diffplug/selfie/issues/174))

## [1.1.1] - 2024-01-25
### Fixed
- Selfie was erroneously garbage collecting snapshots when a test class contained no `@Test public` methods. ([#124](https://github.com/diffplug/selfie/pull/124) fixes [#123](https://github.com/diffplug/selfie/issues/123))

## [1.1.0] - 2024-01-21
### Added
- Support for `@ParameterizedTest`. ([#118](https://github.com/diffplug/selfie/pull/118))
- `ArraySet<K>` has been added to the standard library alongside `ArrayMap<K, V>`. ([#119](https://github.com/diffplug/selfie/pull/119))
  - These have the strange property that if the key is `String`, then `/` characters are sorted to be the lowest possible character.
### Fixed
- We already [smuggle errors from initialization](https://github.com/diffplug/selfie/pull/94) to help debug them, and now we also smuggle errors that happen during test execution. ([#117](https://github.com/diffplug/selfie/pull/117))
- Fix a garbage collection bug which occurred when a test method's name was a prefix of another test method's name. ([#119](https://github.com/diffplug/selfie/pull/119))

## [1.0.1] - 2024-01-19
### Fixed
- Fix `CompoundLens` for Java users.

## [1.0.0] - 2024-01-18
### Added
- Full support for binary snapshots. ([#108](https://github.com/diffplug/selfie/pull/108))
### Fixed
- Groovy multiline string values just go into `"` strings instead of `"""` until we have a chance to implement them properly. ([#107](https://github.com/diffplug/selfie/pull/107))

## [0.3.0] - 2024-01-17
### Added
- `toBe("mismatched")` now gets rewritten in write mode
- fully implemented the new control scheme ([#74](https://github.com/diffplug/selfie/issues/74))
- integers get `_` separators for thousands, millions, etc
### Known broken
- Groovy multiline strings
- Binary

## [0.2.0] - 2023-12-27
### Added
- `DiskSelfie.toMatchDisk` now returns `DiskSelfie` so that we can fluently chain inline assertions on facets.

## [0.1.3] - 2023-12-26
- Publish `selfie-lib-jvm` *and* `selfie-lib` to Maven Central.

## [0.1.2] - 2023-12-26
- Publish `selfie-lib-jvm` instead of just `selfie-lib` to Maven Central.

## [0.1.1] - 2023-12-24
- Initial release, take 2.

## [0.1.0] - 2023-12-24
- Initial release.
