package com.diffplug.selfie.junit5

import kotlin.test.Test

class SimpleTestThatAlwaysPasses {
  @Test fun makesSureTheresAlwaysAtLeastOneTestRunning() {
// otherwise there might be no tests running at all, which is a
// corner case we don't particularly need to spend time on
  }
}
