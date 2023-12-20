package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Ignore
import kotlin.test.Test
// spotless:on

@Ignore
class UT_InlineStringTest {
  @Test fun singleLine() {
    expectSelfie("Hello world").toBe_TODO()
  }
}
