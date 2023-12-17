package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test

class UT_ReadWriteTest {
  @Test fun selfie() {
//    expectSelfie("apple").toMatchDisk()
    expectSelfie("orange").toMatchDisk()
  }
}
