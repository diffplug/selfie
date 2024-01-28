package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test

// spotless:on

class UT_WithinMethodGCTest {
  @Test fun selfie2() {
//  @Test fun selfie() {
//    expectSelfie("root").toMatchDisk()
    expectSelfie("oak").toMatchDisk("leaf")
  }
//
  @Test fun secondMethod() {
    expectSelfie("abc123").toMatchDisk()
  }
}
