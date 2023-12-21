package undertest.junit5

import com.diffplug.selfie.CompoundPrism
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SnapshotLens
import com.diffplug.selfie.SnapshotValue
import com.diffplug.selfie.junit5.StandardSelfieSettings

class SettingsLensCount : StandardSelfieSettings() {
  override fun setupPrismTrain(prismTrain: CompoundPrism) {
    prismTrain
        .forEverySnapshot()
        .addLens(
            object : SnapshotLens {
              override val defaultLensName = "count"

              override fun transform(snapshot: Snapshot) =
                  SnapshotValue.of(snapshot.value.valueString().count().toString())
            })
  }
}
