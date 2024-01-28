package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test
// spotless:on

class UT_InteractiveTest {
  @Test fun example() {
    expectSelfie(10).toBe(10)
  }
}
