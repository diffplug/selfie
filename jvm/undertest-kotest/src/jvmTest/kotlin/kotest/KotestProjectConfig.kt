package kotest

import com.diffplug.selfie.kotest.SelfieExtension
import io.kotest.core.config.AbstractProjectConfig

object KotestProjectConfig : AbstractProjectConfig() {
  override fun extensions() = listOf(SelfieExtension(this))
}
