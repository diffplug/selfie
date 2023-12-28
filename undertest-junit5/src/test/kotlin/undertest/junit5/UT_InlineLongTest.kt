package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test
// spotless:on

class UT_InlineLongTest {
  @Test fun singleInt() {
    expectSelfie(9999999999).toBe(9999999999)
  }
}
