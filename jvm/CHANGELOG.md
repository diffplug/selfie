# Changelog
Changelog for the selfie JVM libraries.

- [`com.diffplug.selfie:selfie-lib:VERSION`](https://central.sonatype.com/artifact/com.diffplug.selfie/selfie-lib)
- [`com.diffplug.selfie:selfie-runner-junit5:VERSION`](https://central.sonatype.com/artifact/com.diffplug.selfie/selfie-runner-junit5)
  - can be used with JUnit4 via [junit-vintage](https://junit.org/junit5/docs/current/user-guide/#migrating-from-junit4)
  - works with Kotest JVM
- [`com.diffplug.selfie:selfie-runner-kotest:VERSION`](https://central.sonatype.com/artifact/com.diffplug.selfie/selfie-runner-kotest)
  - written in Kotlin Multiplatform
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Fixed
- Restore support for JRE 11. (fixes [#528](https://github.com/diffplug/selfie/issues/528))
- snapshots created by `junit.jupiter.api.TestFactory` are no longer garbage-collected (#534)

## [2.5.2] - 2025-04-28
### Fixed
- Off-by-one in the error message for a VCR key mismatch. ([#526](https://github.com/diffplug/selfie/pull/526))
- Fix `StringIndexOutOfBoundsException` when an empty snapshot had a facet added. (fixes [#529](https://github.com/diffplug/selfie/issues/529))
- Fix `ClassCastException` when multiple nested test cases need to update snapshot. (fixes [#531](https://github.com/diffplug/selfie/issues/531))

## [2.5.1] - 2025-03-04
### Fixed
- Selfie VCR is now out of beta, no opt-in required. ([#525](https://github.com/diffplug/selfie/pull/525))
  - ArrayMap now sorts strings with multi-digit numbers as `1 2 ... 9 10 11` instead of `1 11 2 ...`.
  - Improved VCR-specific error messages for determining why `//selfieonce` might not be working for a test rule.
  - Fixed some bugs in VCR data storage (specifically concurrency and multiple frames).

## [2.5.0] - 2025-02-21
### Added
- Added an entrypoint `Selfie.vcrTestLocator()` for the new `VcrSelfie` class for snapshotting and replaying network traffic. ([#517](https://github.com/diffplug/selfie/pull/517/files))
### Fixed
- Fixed a bug when saving facets containing keys with the `]` character ([#518](https://github.com/diffplug/selfie/pull/518)) 

## [2.4.2] - 2025-01-01
### Fixed
- A single leading space (such as in the copyright header) should not override an otherwise 100% tab-indented file. ([#506](https://github.com/diffplug/selfie/issues/506))

## [2.4.1] - 2024-10-07
### Fixed
- Multiline `toBe` assertions (introduced in `2.1.0` for Java pre-15) were not throwing exceptions on snapshot mismatch, now fixed. ([#479](https://github.com/diffplug/selfie/pull/479))

## [2.4.0] - 2024-10-01
### Added
- Snapshot mismatch error messages now show a diff of the first mismatched line. ([#477](https://github.com/diffplug/selfie/pull/477))
  - before
    ```
    Snapshot mismatch
    - update this snapshot by adding `_TODO` to the function name
    - update all snapshots in this file by adding `//selfieonce` or `//SELFIEWRITE`
    ```
  - after
    ```
    Snapshot mismatch at L7:C9
    -Testing 123
    +Testing ABC
    ‣ update this snapshot by adding `_TODO` to the function name
    ‣ update all snapshots in this file by adding `//selfieonce` or `//SELFIEWRITE`
    ```

## [2.3.0] - 2024-07-11
### Added
- `DiskSelfie` now makes the `Snapshot actual` value public, so that other testing infrastructure can read from snapshotted values. ([#467](https://github.com/diffplug/selfie/pull/467))
### Fixed
- `cacheSelfie` was missing `@JvmOverloads` on the methods with default arguments. ([#425](https://github.com/diffplug/selfie/pull/425))

## [2.2.1] - 2024-06-05
### Fixed
- Added `Selfie.expectSelfies(Iterable<T> items, Function<T, String> toString)` for doing easy "multi-asserts" in `suspend fun` also. ([#421](https://github.com/diffplug/selfie/pull/421))

## [2.2.0] - 2024-06-04
### Added
- `SelfieSettingsAPI` now has a field `javaDontUseTripleQuoteLiterals` which ensures that multiline strings are always encoded as `"` strings. ([#417](https://github.com/diffplug/selfie/pull/417))

## [2.1.0] - 2024-06-03
### Added
- Added `Selfie.expectSelfies(Iterable<T> items, Function<T, String> toString)` for doing easy "multi-asserts". ([#416](https://github.com/diffplug/selfie/pull/416))
- For java versions which don't support multiline string literals, we now encode multiline strings like so: ([#406](https://github.com/diffplug/selfie/pull/406))
  - ```java
    toBe("line1",
         "line2",
         "line3");
    ```
### Changed
- Bump Kotlin to 2.0.0. ([#405](https://github.com/diffplug/selfie/pull/405))
### Fixed
- Do not remove stale snapshot files when readonly is true. ([#367](https://github.com/diffplug/selfie/pull/367))
- Provide more debugging info when a snapshot gets set multiple times. (helps with [#370](https://github.com/diffplug/selfie/issues/370))

## [2.0.2] - 2024-03-20
### Fixed
- `toBeFile` now checks for duplicate writes and throws a more helpful error message if the file doesn't exist. ([#277](https://github.com/diffplug/selfie/pull/277))

## [2.0.1] - 2024-02-24
### Fixed
- The `coroutines` methods used to eagerly throw an exception if they were ever called from anywhere besides a Kotest method. Now they wait until `toMatchDisk()` is called, because they can work just fine anywhere if you use `toBe`. ([#247](https://github.com/diffplug/selfie/pull/247))

## [2.0.0] - 2024-02-21
### Added
- **Memoization** ([#219](https://github.com/diffplug/selfie/pull/219) implements [#215](https://github.com/diffplug/selfie/issues/215))
  - like `expectSelfie`, all are available as `Selfie.cacheSelfie` or as `suspend fun` in `com.diffplug.selfie.coroutines`. 
```kotlin
val cachedResult: ByteArray = Selfie.cacheSelfieBinary { dalleJpeg() }.toBeFile("example.jpg")
val cachedResult: String    = Selfie.cacheSelfie { someString() }.toBe("what it was earlier")
val cachedResult: T         = Selfie.cacheSelfieJson { anyKotlinxSerializable() }.toBe("""{"key": "value"}""")
val cachedResult: T         = Selfie.cacheSelfieBinarySerializable { anyJavaIoSerializable() }.toMatchDisk()
```
- `toBeBase64` and `toBeFile` for true binary comparison of binary snapshots and facets. ([#224](https://github.com/diffplug/selfie/pull/224))
- spaces in multiline string literals aren't always escaped. ([#220](https://github.com/diffplug/selfie/issues/220))
  - if the leading spaces in the string literal match the file's existing indentation
### Changed
- **BREAKING** reordered a class hierarchy for better binary support. ([#221](https://github.com/diffplug/selfie/issues/221))
  - most users won't need to make any changes at all
  - only exception is that `expectSelfie(byte[]).toBe` is now a compile error, must do `toBeBase64`

## [1.2.0] - 2024-02-12
### Added
- **Kotest support**.
  - Add `SelfieExtension` to your `AbstractProjectConfig`.
  - Instead of calling `Selfie.expectSelfie`, call `com.diffplug.selfie.coroutines.expectSelfie`.
  - `selfie-runner-junit5` supports snapshots in regular JUnit tests and Kotest tests in the same project.
  - `selfie-runner-kotest` is a new selfie implemented in Kotlin Multiplatform, but doesn't support snapshots within regular JUnit tests.
  - Full docs at https://selfie.dev/jvm/kotest.
### Fixed
- Swap thread-local cache for thread-ignorant LRU to improve performance when used with coroutines. ([#191](https://github.com/diffplug/selfie/pull/191))
### Changes
- (no user-facing changes) replaced terrible platform-specific `Path` with `TypedPath`. ([#184](https://github.com/diffplug/selfie/pull/184))
- (no user-facing changes) replaced `SnapshotStorage` with `SnapshotSystem` + `DiskStorage`. ([#198](https://github.com/diffplug/selfie/pull/198))
- (no user-facing changes) replaced most `synchronized` with CAS. ([#199](https://github.com/diffplug/selfie/pull/199))

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
