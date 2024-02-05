# Module selfie-runner-junit5

<!-- This div needs to stay, it keeps styling consistent between multiplatform and singleplatform module readmes. -->
<div class="selfie-box selfie-box--border">

A selfie test runner for junit5 and junit4 (via junit-vintage). High level docs for this live at [selfie.dev](https://selfie.dev/jvm/get-started).

## Kotest hiccup

This project has TWO test tasks

- `test` runs everything except `@Tag("kotest")`
- `testKotest` runs only `@Tag("kotest")`

Without separating the Kotest tests in this way, we hit a Gradle "bug" (see [#200](https://github.com/diffplug/selfie/pull/200), but we're using Gradle very strange.

So if you want to run the tests, make sure that you run `test` and `testKotest` separately. 

</div>