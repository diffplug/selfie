package undertest.junit5

import com.diffplug.selfie.Selfie
import io.kotest.core.spec.style.FunSpec
import kotlinx.coroutines.delay

class UT_KotestConcurrencyStressTest :
    FunSpec({
      concurrency = 100
      for (d in 1..1000) {
        val digit = d
        test(String.format("test %04d", digit)) {
          val later = Selfie.later()
          delay(digit.toLong())
          later.expectSelfie(digit.toString()).toMatchDisk()
        }
      }
    })
