package undertest.junit5

import com.diffplug.selfie.junit5.SelfieSettingsAPI

class SelfieWriteOnce : SelfieSettingsAPI() {
  override val allowMultipleEquivalentWritesToOneLocation = false
}
