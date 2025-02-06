package undertest.junit4

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test

class UT_WrongContextInJUnit {
  @Test fun wrongContext() {
    try {
      runBlocking { com.diffplug.selfie.coroutines.expectSelfie("something").toMatchDisk() }
    } catch (e: Throwable) {
      com.diffplug.selfie.Selfie.expectSelfie(e.message!!)
          .toBe(
              """No Kotest test is in progress on this coroutine.
If this is a Kotest test, make sure you added `SelfieExtension` to your `AbstractProjectConfig`:
${' '} +class MyProjectConfig : AbstractProjectConfig() {
${' '} +  override fun extensions() = listOf(SelfieExtension(this))
${' '} +}
If this is a JUnit test, make the following change:
${' '} -import com.diffplug.selfie.coroutines.expectSelfie
${' '} +import com.diffplug.selfie.Selfie.expectSelfie
For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines""")
    }
  }
}
