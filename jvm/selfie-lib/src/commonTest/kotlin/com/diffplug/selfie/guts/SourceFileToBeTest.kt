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

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SourceFileToBeTest {
  @Test
  fun todo() {
    javaTest(".toBe_TODO()", ".toBe_TODO()", "")
    javaTest("  .toBe_TODO()  ", ".toBe_TODO()", "")
    javaTest("  .toBe_TODO( )  ", ".toBe_TODO( )", "")
    javaTest("  .toBe_TODO( \n )  ", ".toBe_TODO( \n )", "")
  }

  @Test
  fun numeric() {
    javaTest(".toBe(7)", ".toBe(7)", "7")
    javaTest("  .toBe(7)", ".toBe(7)", "7")
    javaTest(".toBe(7)  ", ".toBe(7)", "7")
    javaTest("  .toBe(7)  ", ".toBe(7)", "7")
    javaTest("  .toBe( 7 )  ", ".toBe( 7 )", "7")
    javaTest("  .toBe(\n7)  ", ".toBe(\n7)", "7")
    javaTest("  .toBe(7\n)  ", ".toBe(7\n)", "7")
  }

  @Test
  fun singleLineString() {
    javaTest(".toBe('7')", "'7'")
    javaTest(".toBe('')", "''")
    javaTest(".toBe( '' )", "''")
    javaTest(".toBe( \n '' \n )", "''")
    javaTest(".toBe( \n '78' \n )", "'78'")
    javaTest(".toBe('\\'')", "'\\''")
  }

  @Test
  fun multiLineString() {
    javaTest(".toBe('''7''')", "'''7'''")
    javaTest(".toBe(''' 7 ''')", "''' 7 '''")
    javaTest(".toBe('''\n7\n''')", "'''\n7\n'''")
    javaTest(".toBe(''' ' '' ' ''')", "''' ' '' ' '''")
  }

  @Test
  fun errorUnclosed() {
    javaTestError(".toBe(", "Appears to be an unclosed function call `.toBe()` on line 1")
    javaTestError(".toBe(  \n ", "Appears to be an unclosed function call `.toBe()` on line 1")
    javaTestError(".toBe_TODO(", "Appears to be an unclosed function call `.toBe_TODO()` on line 1")
    javaTestError(
        ".toBe_TODO(  \n ", "Appears to be an unclosed function call `.toBe_TODO()` on line 1")

    javaTestError(".toBe_TODO(')", "Appears to be an unclosed string literal `\"` on line 1")
    javaTestError(
        ".toBe_TODO(''')", "Appears to be an unclosed multiline string literal `\"\"\"` on line 1")
  }

  @Test
  fun errorNonPrimitive() {
    javaTestError(
        ".toBe(1 + 1)",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1")
    javaTestError(
        ".toBe('1' + '1')",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1")
    javaTestError(
        ".toBe('''1''' + '''1''')",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1")
  }
  private fun javaTestError(sourceRaw: String, errorMsg: String) {
    shouldThrow<AssertionError> { javaTest(sourceRaw, "unusedArg") }.message shouldBe errorMsg
  }
  private fun javaTest(sourceRaw: String, functionCallPlusArgRaw: String) {
    javaTest(sourceRaw, sourceRaw, functionCallPlusArgRaw)
  }
  private fun javaTest(sourceRaw: String, functionCallPlusArgRaw: String, argRaw: String) {
    val source = sourceRaw.replace('\'', '"')
    val functionCallPlusArg = functionCallPlusArgRaw.replace('\'', '"')
    val arg = argRaw.replace('\'', '"')
    val parsed = SourceFile("UnderTest.java", source)
    parsed.parseToBeLike(1).functionCallPlusArg.toString() shouldBe functionCallPlusArg
    parsed.parseToBeLike(1).arg.toString() shouldBe arg
  }
}
