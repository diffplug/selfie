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

  @Test
  fun extraLine1() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("123", "123ABC") shouldBe
        """Snapshot mismatch at L1:C4
-123
+123ABC"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("123ABC", "123") shouldBe
        """Snapshot mismatch at L1:C4
-123ABC
+123"""
  }

  @Test
  fun extraLine2() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("line\n123", "line\n123ABC") shouldBe
        """Snapshot mismatch at L2:C4
-123
+123ABC"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("line\n123ABC", "line\n123") shouldBe
        """Snapshot mismatch at L2:C4
-123ABC
+123"""
  }

  @Test
  fun extraLine() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("line", "line\nnext") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) added
+next"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("line\nnext", "line") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) removed
-next"""
  }

  @Test
  fun extraNewline() {
    SnapshotNotEqualErrorMsg.forUnequalStrings("line", "line\n") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) added
+"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("line\n", "line") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) removed
-"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("", "\n") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) added
+"""
    SnapshotNotEqualErrorMsg.forUnequalStrings("\n", "") shouldBe
        """Snapshot mismatch at L2:C1 - line(s) removed
-"""
  }
}
