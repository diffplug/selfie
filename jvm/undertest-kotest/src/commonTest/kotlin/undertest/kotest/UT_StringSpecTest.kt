package undertest.kotest

import com.diffplug.selfie.SelfieSuspend.expectSelfie
import io.kotest.core.spec.style.StringSpec

class UT_StringSpecTest :
    StringSpec({
      "a" { expectSelfie("a").toMatchDisk() }
      "b" { expectSelfie("b").toMatchDisk() }
      "c" { expectSelfie("c").toMatchDisk() }
    })
