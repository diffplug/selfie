package undertest.junit4

import kotlinx.coroutines.runBlocking
import org.junit.Test

class UT_WrongContextInJUnit {
  @Test fun wrongContext() {
    try {
      runBlocking { com.diffplug.selfie.coroutines.expectSelfie("something").toMatchDisk() }
    } catch (e: Throwable) {
      com.diffplug.selfie.Selfie.expectSelfie(e.message!!)
          .toBe(
              """No JUnit test is in progress on this thread. If this is a Kotest test, make the following change:
${' '} -import com.diffplug.selfie.Selfie.expectSelfie
${' '} +import com.diffplug.selfie.coroutines.expectSelfie
For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines""")
    }
  }
}
