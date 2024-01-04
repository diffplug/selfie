package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test

class UT_DiskTodo {
  @Test fun selfie() {
    expectSelfie("noArg").toMatchDisk_TODO()
    expectSelfie("constantArg").toMatchDisk_TODO("constantArg")
    val theArg = "variable" + " " + "arg"
    expectSelfie("variableArg").toMatchDisk_TODO(theArg)
  }
}
