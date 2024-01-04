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

import com.diffplug.selfie.junit5.SelfieSettingsAPI
import com.diffplug.selfie.junit5.SnapshotFileLayoutJUnit5
import com.diffplug.selfie.junit5.SnapshotStorageJUnit5
import com.diffplug.selfie.recordCall
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class RecordCallTest {
  @Test
  fun testRecordCall() {
    val stack = recordCall()
    // shows as clickable link in IDE
    val settings = SelfieSettingsAPI()
    val layout = SnapshotFileLayoutJUnit5(settings, SnapshotStorageJUnit5.fs)
    stack.location.ideLink(layout) shouldBe
        "testpkg.RecordCallTest.testRecordCall(RecordCallTest.kt:29)"
    stack.restOfStack.size shouldBeGreaterThan 0
  }
}
