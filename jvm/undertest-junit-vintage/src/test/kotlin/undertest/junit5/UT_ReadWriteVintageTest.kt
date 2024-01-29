package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.Test

class UT_ReadWriteVintageTest {
  @Test fun selfie() {
//    expectSelfie("apple").toMatchDisk()
    expectSelfie("orange").toMatchDisk()
  }
}
