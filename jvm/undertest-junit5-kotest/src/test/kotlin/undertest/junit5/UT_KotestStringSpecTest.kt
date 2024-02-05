package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import io.kotest.core.spec.style.StringSpec

class UT_KotestStringSpecTest :
    StringSpec({
      "a" { expectSelfie("a").toMatchDisk() }
      "b" { expectSelfie("b").toMatchDisk() }
      "c" { expectSelfie("c").toMatchDisk() }
    })
