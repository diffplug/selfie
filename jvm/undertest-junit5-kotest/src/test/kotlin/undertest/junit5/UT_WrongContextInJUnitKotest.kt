package undertest.junit5

import com.diffplug.selfie.Selfie
import io.kotest.core.spec.style.FunSpec

class UT_WrongContextInJUnitKotest :
    FunSpec({
      test("wrongContext") {
        try {
          Selfie.expectSelfie("something").toMatchDisk()
        } catch (e: Throwable) {
          com.diffplug.selfie.coroutines
              .expectSelfie(e.message!!)
              .toBe(
                  """No JUnit test is in progress on this thread. If this is a Kotest test, make the following change:
${' '} -import com.diffplug.selfie.Selfie.expectSelfie
${' '} +import com.diffplug.selfie.coroutines.expectSelfie
For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines""")
        }
      }
    })
