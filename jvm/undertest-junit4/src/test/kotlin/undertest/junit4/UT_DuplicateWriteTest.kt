package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.Test

class UT_DuplicateWriteTest {
//  @Test fun shouldFail() {
//    expectSelfie("apples").toMatchDisk()
//    expectSelfie("oranges").toMatchDisk()
//  }
  @Test fun shouldPass() {
    expectSelfie("twins").toMatchDisk()
    expectSelfie("twins").toMatchDisk()
  }
}
