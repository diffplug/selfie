package undertest.junit5

import com.diffplug.selfie.coroutines.expectSelfie
import io.kotest.core.spec.style.FunSpec

class UT_KotestFunSpecTest :
    FunSpec({
      test("a") { expectSelfie("a").toMatchDisk() }
      test("b") { expectSelfie("b").toMatchDisk() }
      test("c") { expectSelfie("c").toMatchDisk() }
    })
