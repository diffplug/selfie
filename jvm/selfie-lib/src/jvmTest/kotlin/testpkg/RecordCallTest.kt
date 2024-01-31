/*
 * Copyright (C) 2023-2024 DiffPlug
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package testpkg

import com.diffplug.selfie.guts.CallLocation
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.recordCall
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class RecordCallTest {
  @Test
  fun testRecordCall() {
    val stack = recordCall(false)
    val layout =
        object : SnapshotFileLayout {
          override val rootFolder: TypedPath
            get() = TODO()
          override val fs: FS
            get() = TODO()
          override val allowMultipleEquivalentWritesToOneLocation: Boolean
            get() = TODO()
          override fun sourcePathForCall(call: CallLocation) = TypedPath("testpkg/RecordCallTest.kt")
          override fun sourcePathForCallMaybe(call: CallLocation): TypedPath? = sourcePathForCall(call)
        }
    stack.location.ideLink(layout) shouldBe
        "testpkg.RecordCallTest.testRecordCall(RecordCallTest.kt:30)"
    stack.restOfStack.size shouldBeGreaterThan 0
    val briefStack = recordCall(true)
    briefStack.location.ideLink(layout) shouldBe
        "testpkg.RecordCallTest.<unknown>(RecordCallTest.kt:-1)"
    briefStack.restOfStack.size shouldBe 0
  }
}
