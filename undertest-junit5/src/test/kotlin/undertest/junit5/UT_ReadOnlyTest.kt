package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test
// spotless:on

class UT_ReadOnlyTest {
  @Test fun example() {
    expectSelfie(5).toBe(5) // selfieonce
  }
}
