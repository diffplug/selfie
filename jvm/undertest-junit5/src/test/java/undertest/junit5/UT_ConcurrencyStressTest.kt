package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.streams.asStream
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.parallel.Execution
import org.junit.jupiter.api.parallel.ExecutionMode

@Execution(ExecutionMode.CONCURRENT)
class UT_ConcurrencyStressTest {
// sanity check: make sure our junit-platform.properties file is getting picked up
  private val latch = CountDownLatch(8)

  @TestFactory
  fun testFactory() =
      (1..1000).asSequence().asStream().map { digit ->
        dynamicTest(String.format("%04d", digit)) {
          latch.countDown()
          latch.await(5, TimeUnit.SECONDS)
          println(Thread.currentThread())
          expectSelfie(digit.toString()).toMatchDisk(String.format("%04d", digit))
        }
      }
}
