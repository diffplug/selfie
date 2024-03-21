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

class LiteralBooleanTest {
  @Test
  fun encode() {
    encode(true, "true")
    encode(false, "false")
  }
  private fun encode(value: Boolean, expected: String) {
    val actual = LiteralBoolean.encode(value, Language.JAVA, EscapeLeadingWhitespace.ALWAYS)
    actual shouldBe expected
  }

  @Test
  fun decode() {
    decode("true", true)
    decode("false", false)
  }
  private fun decode(value: String, expected: Boolean) {
    val actual = LiteralBoolean.parse(value, Language.JAVA)
    actual shouldBe expected
  }
}
