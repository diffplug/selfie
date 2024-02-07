package undertest.kotest

import com.diffplug.selfie.SelfieSuspend.expectSelfie
import io.kotest.core.spec.style.FunSpec
import kotlinx.coroutines.delay

class UT_ConcurrencyStressTest :
    FunSpec({
      concurrency = 100
      for (d in 1..1000) {
        val digit = d
        test(String.format("test %04d", digit)) {
          delay(digit.toLong())
          expectSelfie(digit.toString()).toMatchDisk()
        }
      }
    })
