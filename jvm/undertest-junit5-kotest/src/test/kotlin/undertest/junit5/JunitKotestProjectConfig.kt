package undertest.junit5

import com.diffplug.selfie.junit5.SelfieExtension
import io.kotest.core.config.AbstractProjectConfig

class JunitKotestProjectConfig : AbstractProjectConfig() {
  override val extensions = listOf(SelfieExtension(this))
}
