package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test
// spotless:on

class UT_InlineIntTest {
  @Test fun singleInt() {
    expectSelfie(1234).toBe(1234)
  }
}
