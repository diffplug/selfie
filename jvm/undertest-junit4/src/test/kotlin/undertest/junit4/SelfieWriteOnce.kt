package undertest.junit4

import com.diffplug.selfie.junit4.SelfieSettingsAPI

class SelfieWriteOnce : SelfieSettingsAPI() {
  override val allowMultipleEquivalentWritesToOneLocation = false
}
