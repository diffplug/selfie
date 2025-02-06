package undertest.junit5

import com.diffplug.selfie.Selfie.expectSelfie
import kotlin.test.Test

class UT_BinaryTest {
  @Test fun emptyOnDisk() {
    expectSelfie(byteArrayOf()).toMatchDisk_TODO()
  }

  @Test fun emptyInline() {
    expectSelfie(byteArrayOf()).toBeBase64_TODO()
  }

  @Test fun bigishOnDisk() {
    expectSelfie(ByteArray(256) { it.toByte() }).toMatchDisk_TODO()
  }

  @Test fun bigishInline() {
    expectSelfie(ByteArray(256) { it.toByte() }).toBeBase64_TODO()
  }
}
