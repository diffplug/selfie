package undertest.junit5

import com.diffplug.selfie.coroutines.expectSelfie
import io.kotest.common.ExperimentalKotest
import io.kotest.core.spec.style.FunSpec
import io.kotest.engine.concurrency.TestExecutionMode
import kotlinx.coroutines.delay

@OptIn(ExperimentalKotest::class)
class UT_KotestConcurrencyStressTest :
    FunSpec({
      testExecutionMode = TestExecutionMode.LimitedConcurrency(100)
      for (d in 1..1000) {
        val digit = d
        test(String.format("test %04d", digit)) {
          delay(digit.toLong())
          expectSelfie(digit.toString()).toMatchDisk()
        }
      }
    })
