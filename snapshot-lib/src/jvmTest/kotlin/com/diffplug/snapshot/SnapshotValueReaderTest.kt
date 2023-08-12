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
package com.diffplug.snapshot

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SnapshotValueReaderTest {
  @Test
  fun noEscapingNeeded() {
    val reader =
        SnapshotValueReader.of(
            """
            ╔═ 00_empty ═╗
            ╔═ 01_singleLineString ═╗
            this is one line
            ╔═ 02_multiLineStringTrimmed ═╗
            Line 1
            Line 2
            ╔═ 03_multiLineStringTrailingNewline ═╗
            Line 1
            Line 2

            ╔═ 04_multiLineStringLeadingNewline ═╗

            Line 1
            Line 2
            ╔═ 05_notSureHowKotlinMultilineWorks ═╗
            """
                .trimIndent())
    reader.peekKey() shouldBe "00_empty"
    reader.peekKey() shouldBe "00_empty"
    reader.nextValue().valueString() shouldBe ""
    reader.peekKey() shouldBe "01_singleLineString"
    reader.peekKey() shouldBe "01_singleLineString"
    reader.nextValue().valueString() shouldBe "this is one line"
    // etc
  }

  @Test
  fun invalidNames() {
    /* TODO
    ╔═name ═╗ error: Expected '╔═ '
    ╔═ name═╗ error: Expected ' ═╗'
    ╔═  name ═╗ error: Leading spaces are disallowed: ' name'
    ╔═ name  ═╗ error: Trailing spaces are disallowed: 'name '
    ╔═ name ═╗ comment okay
    ╔═ name ═╗okay here too
    ╔═ name ═╗ okay  ╔═ ═╗ (it's the first ' ═╗' that counts)
             */
  }

  @Test
  fun escapeCharactersInName() {
    /* TODO
    ╔═ test with \∕slash\∕ in name ═╗
    ╔═ test with \(square brackets\) in name ═╗
    ╔═ test with \\backslash\\ in name ═╗
    ╔═ test with \nnewline\n in name ═╗
    ╔═ test with \ttab\t in name ═╗
    ╔═ test with \┌\─ ascii art \┐\─ in name ═╗
     */
  }

  @Test
  fun escapeCharactersInBody() {
    /* TODO
    ╔═ ascii art okay ═╗
     ╔══╗
    ╔═ escaped iff on first line ═╗
    𐝁══╗
    ╔═ body escape characters ═╗
    𐝃𐝁𐝃𐝃 linear a is dead
     */
  }
}
