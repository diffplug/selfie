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
  fun encodeSingleJava() {
    encodeSingleJava("1", "'1'")
    encodeSingleJava("\\", "'\\\\'")
    encodeSingleJava("1\n\tABC", "'1\\n\\tABC'")
  }
  private fun encodeSingleJava(value: String, expected: String) {
    val actual = LiteralString.encodeSingleJava(value)
    actual shouldBe expected.replace("'", "\"")
  }

  @Test
  fun encodeSingleJavaWithDollars() {
    encodeSingleJavaWithDollars("1", "`1`")
    encodeSingleJavaWithDollars("\\", "`\\\\`")
    encodeSingleJavaWithDollars("$", "`s{'s'}`".replace('s', '$'))
    encodeSingleJavaWithDollars("1\n\tABC", "`1\\n\\tABC`")
  }
  private fun encodeSingleJavaWithDollars(value: String, expected: String) {
    val actual = LiteralString.encodeSingleJavaWithDollars(value)
    actual shouldBe expected.replace("`", "\"")
  }

  @Test
  fun encodeMultiJava() {
    encodeMultiJava("1", "'''\n1'''")
    encodeMultiJava("\\", "'''\n\\\\'''")
    encodeMultiJava("  leading\ntrailing  ", "'''\n" + "\\s leading\n" + "trailing \\s'''")
  }
  private fun encodeMultiJava(value: String, expected: String) {
    val actual = LiteralString.encodeMultiJava(value)
    actual shouldBe expected.replace("'", "\"")
  }
  private val KOTLIN_DOLLAR = "s{'s'}".replace('s', '$')

  @Test
  fun encodeMultiKotlin() {
    encodeMultiKotlin("1", "```1```")
    encodeMultiKotlin("$", "```$KOTLIN_DOLLAR```")
  }
  private fun encodeMultiKotlin(value: String, expected: String) {
    val actual = LiteralString.encodeMultiKotlin(value)
    actual shouldBe expected.replace("`", "\"")
  }

  @Test
  fun parseSingleJava() {
    parseSingleJava("1", "1")
    parseSingleJava("\\\\", "\\")
    parseSingleJava("1\\n\\tABC", "1\n\tABC")
  }
  private fun parseSingleJava(value: String, expected: String) {
    val actual = LiteralString.parseSingleJava("\"${value.replace("'", "\"")}\"")
    actual shouldBe expected
  }

  @Test
  fun parseMultiJava() {
    parseMultiJava("\n123\nabc", "123\nabc")
    parseMultiJava("\n  123\n  abc", "123\nabc")
    parseMultiJava("\n  123  \n  abc\t", "123\nabc")
    parseMultiJava("\n  123  \n  abc\t", "123\nabc")
    parseMultiJava("\n  123  \\s\n  abc\t\\s", "123   \nabc\t ")
  }
  private fun parseMultiJava(value: String, expected: String) {
    val actual = LiteralString.parseMultiJava("\"\"\"${value.replace("'", "\"")}\"\"\"")
    actual shouldBe expected
  }

  @Test
  fun parseSingleJavaWithDollars() {
    parseSingleJavaWithDollars("1", "1")
    parseSingleJavaWithDollars("\\\\", "\\")
    parseSingleJavaWithDollars("s{'s'}".replace('s', '$'), "$")
    parseSingleJavaWithDollars("1\\n\\tABC", "1\n\tABC")
  }
  private fun parseSingleJavaWithDollars(value: String, expected: String) {
    val actual = LiteralString.parseSingleJavaWithDollars("\"${value}\"")
    actual shouldBe expected
  }
}
