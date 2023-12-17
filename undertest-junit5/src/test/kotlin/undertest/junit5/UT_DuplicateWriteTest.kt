package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.jupiter.api.Test

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
