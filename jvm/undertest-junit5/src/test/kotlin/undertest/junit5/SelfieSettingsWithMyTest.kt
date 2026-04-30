package undertest.junit5

import com.diffplug.selfie.junit5.SelfieSettingsAPI

class SelfieSettingsWithMyTest : SelfieSettingsAPI() {
  override val testAnnotations: List<String>
    get() = super.testAnnotations + "undertest.junit5.MyTest"
}
