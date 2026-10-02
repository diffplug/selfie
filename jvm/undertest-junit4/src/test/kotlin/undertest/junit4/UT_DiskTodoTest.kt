package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.Test

class UT_DiskTodoTest {
  @Test fun selfie() {
    expectSelfie("noArg").toMatchDisk_TODO()
    expectSelfie("constantArg").toMatchDisk_TODO("constantArg")
    val theArg = "variable" + " " + "arg"
    expectSelfie("variableArg").toMatchDisk_TODO(theArg)
  }
}
