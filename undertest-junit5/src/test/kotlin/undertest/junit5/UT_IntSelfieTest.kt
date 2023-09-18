package undertest.junit5
// spotless:off
import com.diffplug.selfie.expectSelfie
import kotlin.test.Test

// spotless:on

class UT_IntSelfieTest {
  @Test fun singleInt() {
    expectSelfie(678) toBe 678
  }
}
