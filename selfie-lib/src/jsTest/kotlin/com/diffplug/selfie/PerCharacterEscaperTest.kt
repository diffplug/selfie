/*
 * Copyright (C) 2016-2023 DiffPlug
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

import com.diffplug.selfie.PerCharacterEscaper.Companion.selfEscape
import com.diffplug.selfie.PerCharacterEscaper.Companion.specifiedEscape
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertSame

class PerCharacterEscaperTest {
  @Test
  fun performanceOptimizationSelf() {
    val escaper = selfEscape("`123")
    // if nothing gets changed, it should return the exact same value
    val abc = "abc"
    assertSame(abc, escaper.escape(abc))
    assertSame(abc, escaper.unescape(abc))

    // otherwise it should have the normal behavior
    assertEquals("`1", escaper.escape("1"))
    assertEquals("``", escaper.escape("`"))
    assertEquals("abc`1`2`3``def", escaper.escape("abc123`def"))

    // in both directions
    assertEquals("1", escaper.unescape("`1"))
    assertEquals("`", escaper.unescape("``"))
    assertEquals("abc123`def", escaper.unescape("abc`1`2`3``def"))
  }

  @Test
  fun performanceOptimizationSpecific() {
    val escaper = specifiedEscape("`a1b2c3d")
    // if nothing gets changed, it should return the exact same value
    val abc = "abc"
    assertSame(abc, escaper.escape(abc))
    assertSame(abc, escaper.unescape(abc))

    // otherwise it should have the normal behavior
    assertEquals("`b", escaper.escape("1"))
    assertEquals("`a", escaper.escape("`"))
    assertEquals("abc`b`c`d`adef", escaper.escape("abc123`def"))

    // in both directions
    assertEquals("1", escaper.unescape("`b"))
    assertEquals("`", escaper.unescape("`a"))
    assertEquals("abc123`def", escaper.unescape("abc`1`2`3``def"))
  }

  @Test
  fun cornerCasesSelf() {
    val escaper = selfEscape("`123")
    // cornercase - escape character without follow-on will throw an error
    val exception = assertFails { escaper.unescape("`") }
    assertEquals("Escape character '`' can't be the last character in a string.", exception.message)
    // escape character followed by non-escape character is fine
    assertEquals("a", escaper.unescape("`a"))
  }

  @Test
  fun cornerCasesSpecific() {
    val escaper = specifiedEscape("`a1b2c3d")
    // cornercase - escape character without follow-on will throw an error
    val exception = assertFails { escaper.unescape("`") }
    assertEquals("Escape character '`' can't be the last character in a string.", exception.message)
    // escape character followed by non-escape character is fine
    assertEquals("e", escaper.unescape("`e"))
  }

  @Test
  fun roundtrip() {
    val escaper = selfEscape("`<>")
    val roundtrip = { str: String? -> assertEquals(str, escaper.unescape(escaper.escape(str!!))) }
    roundtrip("")
    roundtrip("<local>~`/")
  }
}
