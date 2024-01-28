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
package com.diffplug.selfie.guts

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class LiteralLongTest {
  @Test
  fun encode() {
    encode(0, "0L")
    encode(1, "1L")
    encode(-1, "-1L")
    encode(999, "999L")
    encode(-999, "-999L")
    encode(1_000, "1_000L")
    encode(-1_000, "-1_000L")
    encode(1_000_000, "1_000_000L")
    encode(-1_000_000, "-1_000_000L")
    encode(2400500, "2_400_500L")
    encode(2400501, "2_400_501L")
    encode(200, "200L")
    encode(1001, "1_001L")
    encode(1010, "1_010L")
    encode(10010, "10_010L")
    encode(9876543210, "9_876_543_210L")
  }
  private fun encode(value: Long, expected: String) {
    val actual = LiteralLong.encode(value, Language.JAVA)
    actual shouldBe expected
  }

  @Test
  fun decode() {
    decode("0", 0)
    decode("1", 1)
    decode("-1", -1)
    decode("999", 999)
    decode("9_99", 999)
    decode("9_9_9", 999)
    decode("-999", -999)
    decode("-9_99", -999)
    decode("-9_9_9", -999)
    decode("9_876_543_210", 9876543210)
    decode("9_876_543_210L", 9876543210)
    decode("-9_876_543_210", -9876543210)
  }
  private fun decode(value: String, expected: Long) {
    val actual = LiteralLong.parse(value, Language.JAVA)
    actual shouldBe expected
  }
}
