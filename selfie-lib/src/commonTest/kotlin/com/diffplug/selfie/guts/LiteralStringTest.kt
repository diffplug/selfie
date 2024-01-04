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

class LiteralStringTest {
  @Test
  fun encode() {
    encode(
        "1",
        """
      "1"
    """
            .trimIndent())
    encode(
        "1\n\tABC",
        """
      "1\n\tABC"
    """
            .trimIndent())
  }
  private fun encode(value: String, expected: String) {
    val actual = LiteralString.encode(value, Language.JAVA)
    actual shouldBe expected
  }

  @Test
  fun decode() {
    decode(
        """
      "1"
    """
            .trimIndent(),
        "1")
    decode(
        """
      "1\n\tABC"
    """
            .trimIndent(),
        "1\n\tABC")
  }
  private fun decode(value: String, expected: String) {
    val actual = LiteralString.parse(value, Language.JAVA)
    actual shouldBe expected
  }
}
