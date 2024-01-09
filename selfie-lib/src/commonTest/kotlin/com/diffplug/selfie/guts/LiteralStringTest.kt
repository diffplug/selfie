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
  fun singleLineJavaToSource() {
    singleLineJavaToSource("1", "'1'")
    singleLineJavaToSource("\\", "'\\\\'")
    singleLineJavaToSource("1\n\tABC", "'1\\n\\tABC'")
  }
  private fun singleLineJavaToSource(value: String, expected: String) {
    val actual = LiteralString.singleLineJavaToSource(value)
    actual shouldBe expected.replace("'", "\"")
  }

  @Test
  fun multiLineJavaToSource() {
    multiLineJavaToSource("1", "'''\n1'''")
    multiLineJavaToSource("\\", "'''\n\\\\'''")
    multiLineJavaToSource("  leading\ntrailing  ", "'''\n" + "\\s leading\n" + "trailing \\s'''")
  }
  private fun multiLineJavaToSource(value: String, expected: String) {
    val actual = LiteralString.multiLineJavaToSource(value)
    actual shouldBe expected.replace("'", "\"")
  }

  @Test
  fun singleLineJavaFromSource() {
    singleLineJavaFromSource("1", "1")
    singleLineJavaFromSource("\\\\", "\\")
    singleLineJavaFromSource("1\\n\\tABC", "1\n\tABC")
  }
  private fun singleLineJavaFromSource(value: String, expected: String) {
    val actual = LiteralString.singleLineJavaFromSource("\"${value.replace("'", "\"")}\"")
    actual shouldBe expected
  }

  @Test
  fun multiLineJavaFromSource() {
    multiLineJavaFromSource("\n123\nabc", "123\nabc")
    multiLineJavaFromSource("\n  123\n  abc", "123\nabc")
    multiLineJavaFromSource("\n  123  \n  abc\t", "123\nabc")
    multiLineJavaFromSource("\n  123  \n  abc\t", "123\nabc")
    multiLineJavaFromSource("\n  123  \\s\n  abc\t\\s", "123   \nabc\t ")
  }
  private fun multiLineJavaFromSource(value: String, expected: String) {
    val actual = LiteralString.multiLineJavaFromSource("\"\"\"${value.replace("'", "\"")}\"\"\"")
    actual shouldBe expected
  }
}
