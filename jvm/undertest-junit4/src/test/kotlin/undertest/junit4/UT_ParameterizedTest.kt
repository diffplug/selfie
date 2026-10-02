package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import java.time.temporal.ChronoUnit
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import org.junit.runners.Parameterized.Parameters

@RunWith(Parameterized::class)
class UT_ParameterizedTest(private val unit: ChronoUnit) {
  companion object {
    @JvmStatic
    @Parameters
    fun data(): Collection<Array<Any>> {
      return ChronoUnit.values()
          .filter { it != ChronoUnit.ERAS && it != ChronoUnit.FOREVER }
          .map { arrayOf(it as Any) }
    }
  }

  @Test fun enumSource() {
    expectSelfie("${unit.name} = ${unit.duration.toMillis()}ms")
        .toMatchDisk(String.format("%02d", unit.ordinal))
  }
}
