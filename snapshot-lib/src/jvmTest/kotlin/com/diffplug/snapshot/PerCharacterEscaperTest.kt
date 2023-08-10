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
package com.diffplug.snapshot

import com.diffplug.snapshot.PerCharacterEscaper.Companion.selfEscape
import com.diffplug.snapshot.PerCharacterEscaper.Companion.specifiedEscape
import java.util.function.Consumer
import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Test

class PerCharacterEscaperTest {
  @Test
  fun performanceOptimizationSelf() {
    val escaper = selfEscape("`123")
    // if nothing gets changed, it should return the exact same value
    val abc = "abc"
    Assertions.assertSame(abc, escaper.doForward(abc))
    Assertions.assertSame(abc, escaper.doBackward(abc))

    // otherwise it should have the normal behavior
    Assertions.assertEquals("`1", escaper.doForward("1"))
    Assertions.assertEquals("``", escaper.doForward("`"))
    Assertions.assertEquals("abc`1`2`3``def", escaper.doForward("abc123`def"))

    // in both directions
    Assertions.assertEquals("1", escaper.doBackward("`1"))
    Assertions.assertEquals("`", escaper.doBackward("``"))
    Assertions.assertEquals("abc123`def", escaper.doBackward("abc`1`2`3``def"))
  }

  @Test
  fun performanceOptimizationSpecific() {
    val escaper = specifiedEscape("`a1b2c3d")
    // if nothing gets changed, it should return the exact same value
    val abc = "abc"
    Assertions.assertSame(abc, escaper.doForward(abc))
    Assertions.assertSame(abc, escaper.doBackward(abc))

    // otherwise it should have the normal behavior
    Assertions.assertEquals("`b", escaper.doForward("1"))
    Assertions.assertEquals("`a", escaper.doForward("`"))
    Assertions.assertEquals("abc`b`c`d`adef", escaper.doForward("abc123`def"))

    // in both directions
    Assertions.assertEquals("1", escaper.doBackward("`b"))
    Assertions.assertEquals("`", escaper.doBackward("`a"))
    Assertions.assertEquals("abc123`def", escaper.doBackward("abc`1`2`3``def"))
  }

  @Test
  fun cornerCasesSelf() {
    val escaper = selfEscape("`123")
    // cornercase - escape character without follow-on will throw an error
    val exception =
        Assertions.assertThrows(java.lang.IllegalArgumentException::class.java) {
          escaper.doBackward("`")
        }
    Assertions.assertEquals(
        "Escape character '`' can't be the last character in a string.", exception.message)
    // escape character followed by non-escape character is fine
    Assertions.assertEquals("a", escaper.doBackward("`a"))
  }

  @Test
  fun cornerCasesSpecific() {
    val escaper = specifiedEscape("`a1b2c3d")
    // cornercase - escape character without follow-on will throw an error
    val exception =
        Assertions.assertThrows(java.lang.IllegalArgumentException::class.java) {
          escaper.doBackward("`")
        }
    Assertions.assertEquals(
        "Escape character '`' can't be the last character in a string.", exception.message)
    // escape character followed by non-escape character is fine
    Assertions.assertEquals("e", escaper.doBackward("`e"))
  }

  @Test
  fun roundtrip() {
    val escaper = selfEscape("`<>")
    val roundtrip = Consumer { str: String? ->
      Assertions.assertEquals(str, escaper.doBackward(escaper.doForward(str!!)))
    }
    roundtrip.accept("")
    roundtrip.accept("<local>~`/")
  }
}
