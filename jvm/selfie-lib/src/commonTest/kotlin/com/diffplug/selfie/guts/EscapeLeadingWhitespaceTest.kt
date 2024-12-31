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

import com.diffplug.selfie.guts.EscapeLeadingWhitespace.*
import com.diffplug.selfie.guts.EscapeLeadingWhitespace.Companion.appropriateFor
import io.kotest.matchers.shouldBe
import kotlin.test.Test

class EscapeLeadingWhitespaceTest {
  @Test
  fun detection() {
    // not enough to detect
    appropriateFor("") shouldBe ALWAYS
    appropriateFor("abc") shouldBe ALWAYS
    appropriateFor("abc\nabc") shouldBe ALWAYS

    // all spaces -> only tabs need escape
    appropriateFor(" ") shouldBe ALWAYS
    appropriateFor("  ") shouldBe ONLY_ON_TAB
    appropriateFor("  \n  ") shouldBe ONLY_ON_TAB

    // all tabs -> only space needs escape
    appropriateFor("\t") shouldBe ONLY_ON_SPACE
    appropriateFor("\t\t") shouldBe ONLY_ON_SPACE
    appropriateFor("\t\n\t") shouldBe ONLY_ON_SPACE

    // it's a mess -> everything needs escape
    appropriateFor("\t\n  ") shouldBe ALWAYS

    // single spaces and tabs -> only tabs need escape
    appropriateFor(
        """
/*
${' '}* Copyright
${' '}*/
interface Foo {
${'\t'}fun bar()
}
""") shouldBe
        ONLY_ON_SPACE
  }
}
