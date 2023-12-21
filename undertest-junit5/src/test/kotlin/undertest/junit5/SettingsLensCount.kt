package undertest.junit5

import com.diffplug.selfie.CompoundLens
import com.diffplug.selfie.SnapshotValue
import com.diffplug.selfie.junit5.StandardSelfieSettings

class SettingsLensCount : StandardSelfieSettings() {
  override fun setupPrismTrain(prismTrain: CompoundLens) {
    prismTrain.forEverySnapshot().addLens("count") { snapshot ->
      SnapshotValue.of(snapshot.subject.valueString().count().toString())
    }
  }
}
