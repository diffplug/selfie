# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
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
