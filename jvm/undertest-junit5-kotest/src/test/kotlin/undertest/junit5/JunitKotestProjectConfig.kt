package undertest.junit5

import com.diffplug.selfie.junit5.SelfieExtension
import io.kotest.core.config.AbstractProjectConfig

class JunitKotestProjectConfig : AbstractProjectConfig() {
  override fun extensions() = listOf(SelfieExtension(this))
}
