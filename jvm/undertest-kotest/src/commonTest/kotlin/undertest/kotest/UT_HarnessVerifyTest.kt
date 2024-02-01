package undertest.kotest

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class UT_HarnessVerifyTest {
  @Test fun alwaysPasses() {
    "true" shouldBe "true"
  }

  @Test fun alwaysFails() {
    "true" shouldBe "false"
  }
}
