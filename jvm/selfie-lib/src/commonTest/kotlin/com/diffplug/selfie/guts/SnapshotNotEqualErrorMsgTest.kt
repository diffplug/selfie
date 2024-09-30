/*
 * Copyright (C) 2024 DiffPlug
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
package com.diffplug.selfie.guts

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SnapshotNotEqualErrorMsgTest {
  @Test
  fun errorLine1() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("Testing 123", "Testing ABC") shouldBe
        """Snapshot mismatch at L1:C9
-Testing 123
+Testing ABC"""

    SnapshotNotEqualErrorMsg.forUnequalStrings("123 Testing", "ABC Testing") shouldBe
        """Snapshot mismatch at L1:C1
-123 Testing
+ABC Testing"""
  }

  @Test
  fun errorLine2() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("Line\nTesting 123", "Line\nTesting ABC") shouldBe
        """Snapshot mismatch at L2:C9
-Testing 123
+Testing ABC"""

    SnapshotNotEqualErrorMsg.forUnequalStrings("Line\n123 Testing", "Line\nABC Testing") shouldBe
        """Snapshot mismatch at L2:C1
-123 Testing
+ABC Testing"""
  }
}
