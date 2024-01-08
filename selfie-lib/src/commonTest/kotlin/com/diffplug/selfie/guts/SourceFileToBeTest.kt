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

class SourceFileToBeTest {
  private fun javaTest(source: String, functionCallPlusArg: String, arg: String) {
    val parsed = SourceFile("UnderTest.java", source)
    if (source.contains(".toBe_TODO(")) {
      parsed.parseToBe_TODO(1).functionCallPlusArg.toString() shouldBe functionCallPlusArg
      parsed.parseToBe_TODO(1).arg.toString() shouldBe arg
    } else {
      parsed.parseToBe(1).functionCallPlusArg.toString() shouldBe functionCallPlusArg
      parsed.parseToBe(1).arg.toString() shouldBe arg
    }
  }

  @Test
  fun parseToBeTodo() {
    javaTest(".toBe_TODO()", ".toBe_TODO()", "")
    javaTest("  .toBe_TODO()  ", ".toBe_TODO()", "")
    javaTest("  .toBe_TODO( )  ", ".toBe_TODO( )", "")
    javaTest("  .toBe_TODO( \n )  ", ".toBe_TODO( \n )", "")
  }

  @Test
  fun parseToBeNumeric() {
    javaTest(".toBe(7)", ".toBe(7)", "7")
    javaTest("  .toBe(7)", ".toBe(7)", "7")
    javaTest(".toBe(7)  ", ".toBe(7)", "7")
    javaTest("  .toBe(7)  ", ".toBe(7)", "7")
    javaTest("  .toBe( 7 )  ", ".toBe( 7 )", "7")
    javaTest("  .toBe(\n7)  ", ".toBe(\n7)", "7")
    javaTest("  .toBe(7\n)  ", ".toBe(7\n)", "7")
  }
}
