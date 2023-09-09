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

class LineReaderTest {

  @Test
  fun shouldFindUnixSeparatorFromBinary() {
    val reader = LineReader.forBinary("This is a new line\n".encodeToByteArray())
    reader.unixNewlines() shouldBe true
    reader.readLine() shouldBe "This is a new line"
  }

  @Test
  fun shouldFindWindowsSeparatorFromBinary() {
    val reader = LineReader.forBinary("This is a new line\r\n".encodeToByteArray())
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "This is a new line"
  }

  @Test
  fun shouldFindUnixSeparatorFromString() {
    val reader = LineReader.forString("This is a new line\n")
    reader.unixNewlines() shouldBe true
    reader.readLine() shouldBe "This is a new line"
  }

  @Test
  fun shouldFindWindowsSeparatorFromString() {
    val reader = LineReader.forString("This is a new line\r\n")
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "This is a new line"
  }

  @Test
  fun shouldGetOSLineSeparatorWhenThereIsNone() {
    val reader = LineReader.forBinary("This is a new line".encodeToByteArray())
    reader.unixNewlines() shouldBe System.lineSeparator().equals("\n")
    reader.readLine() shouldBe "This is a new line"
  }

  @Test
  fun shouldReadNextLineWithoutProblem() {
    val reader = LineReader.forBinary("First\r\nSecond\r\n".encodeToByteArray())
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "First"
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "Second"
    reader.unixNewlines() shouldBe false
  }

  @Test
  fun shouldUseFirstLineSeparatorAndIgnoreNext() {
    val reader = LineReader.forBinary("First\r\nAnother separator\n".encodeToByteArray())
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "First"
    reader.unixNewlines() shouldBe false
    reader.readLine() shouldBe "Another separator"
    reader.unixNewlines() shouldBe false
  }
}
