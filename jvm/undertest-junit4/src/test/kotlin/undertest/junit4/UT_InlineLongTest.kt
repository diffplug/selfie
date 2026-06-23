package undertest.junit4
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test
// spotless:on

class UT_InlineLongTest {
  @Test fun singleInt() {
    expectSelfie(9999999999L).toBe(9_999_999_999L)
  }
}
