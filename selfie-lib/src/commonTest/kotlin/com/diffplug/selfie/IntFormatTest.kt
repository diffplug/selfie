/*
 * Copyright (C) 2023 DiffPlug
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
package com.diffplug.selfie

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class IntFormatTest {
  @Test
  fun encode() {
    encode(0, "0")
    encode(1, "1")
    encode(-1, "-1")
    encode(999, "999")
    encode(-999, "-999")
    // TODO: add underscores
    encode(1_000, "1000")
    encode(-1_000, "-1000")
    encode(1_000_000, "1000000")
    encode(-1_000_000, "-1000000")
  }
  private fun encode(value: Int, expected: String) {
    val actual = IntFormat().encode(value)
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
  }
  private fun decode(value: String, expected: Int) {
    val actual = IntFormat().parse(value)
    actual shouldBe expected
  }
}
