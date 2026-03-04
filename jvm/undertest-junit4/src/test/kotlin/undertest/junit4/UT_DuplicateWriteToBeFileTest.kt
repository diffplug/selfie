package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.Test

class UT_DuplicateWriteToBeFileTest {
//  @Test fun shouldFail() {
//    expectSelfie("apples".toByteArray()).toBeFile("duplicate_tobefile.data")
//    expectSelfie("oranges".toByteArray()).toBeFile("duplicate_tobefile.data")
//  }
  @Test fun shouldPass() {
    expectSelfie("twins".toByteArray()).toBeFile("duplicate_tobefile.data")
    expectSelfie("twins".toByteArray()).toBeFile("duplicate_tobefile.data")
  }
}
