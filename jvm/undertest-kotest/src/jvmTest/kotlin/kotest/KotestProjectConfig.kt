package kotest

import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.extensions.Extension
// it's super weird that we can't just say `com.diffplug.selfie.kotest.SelfieExtension`
// pretty sure it's a bug in the Kotlin multiplatform plugin
val SelfieExtension =
    Class.forName("com.diffplug.selfie.kotest.SelfieExtension").let {
      it.getField("INSTANCE").get(null)
    } as Extension

object KotestProjectConfig : AbstractProjectConfig() {
  override fun extensions() = listOf(SelfieExtension)
}
