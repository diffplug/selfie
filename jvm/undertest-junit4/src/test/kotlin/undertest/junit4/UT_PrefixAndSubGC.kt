package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.jupiter.api.Test

class UT_PrefixAndSubGC {
  @Test fun commonPrefix() {
    expectSelfie("cision").toMatchDisk("noun")
    expectSelfie("cise").toMatchDisk("adjective")
  }

  @Test fun commonPrefixThenMore() {
    expectSelfie("pre").toMatchDisk()
  }
}
