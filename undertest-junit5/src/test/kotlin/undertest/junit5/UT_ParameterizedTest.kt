package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import java.time.temporal.ChronoUnit
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource

class UT_ParameterizedTest {
  @ParameterizedTest
  @EnumSource
  fun enumSource(unit: ChronoUnit) {
    if (unit == ChronoUnit.ERAS || unit == ChronoUnit.FOREVER) {
      return
    }
    expectSelfie("${unit.name} = ${unit.duration.toMillis()}ms")
        .toMatchDisk(String.format("%02d", unit.ordinal))
  }
}
