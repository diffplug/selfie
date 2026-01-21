package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test

class UT_CarriageReturnTest {
  @Test fun git_makes_carriage_returns_unrepresentable() {
    expectSelfie("hard\r\nto\npreserve\r\nthis\r\n").toMatchDisk()
  }
}
