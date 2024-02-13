package undertest.kotest

import com.diffplug.selfie.Selfie
import com.diffplug.selfie.coroutines.expectSelfie
import io.kotest.core.spec.style.FunSpec

class UT_WrongContextInKotest :
    FunSpec({
      test("wrongContext") {
        try {
          Selfie.expectSelfie("something").toMatchDisk()
        } catch (e: Throwable) {
          expectSelfie(e.message!!)
              .toBe(
                  """Kotest tests must use the `suspend` versions of the `expectSelfie` function.
You can fix this by making the following change:
${' '} -import com.diffplug.selfie.Selfie.expectSelfie
${' '} +import com.diffplug.selfie.coroutines.expectSelfie
For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines""")
        }
      }
    })
