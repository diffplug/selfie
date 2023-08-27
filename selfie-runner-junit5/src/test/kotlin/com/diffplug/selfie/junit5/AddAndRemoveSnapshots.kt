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
package com.diffplug.selfie.junit5

import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder

// @Ignore
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class AddAndRemoveSnapshots : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfiesNoFile() {
    // the body of the class should be totally commented out at the start of the test
    ut_mirror()
        .linesFrom("UT_AddAndRemoveSnapshots")
        .toLast("}")
        .shrinkByOne()
        .assertCommented(true)
    gradleWriteSS()
    ut_snapshot().assertDoesNotExist()
  }

  @Test @Order(2)
  fun firstSelfieCreatesFile() {
    ut_mirror().linesFrom("fun one").toFirst("}").uncomment()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ one ═╗
      1
      ╔═ [end of file] ═╗
    """
                .trimIndent())
  }

  @Test @Order(3)
  fun secondSelfieAppendsFile() {
    ut_mirror().linesFrom("fun two").toFirst("}").uncomment()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ one ═╗
      1
      ╔═ two ═╗
      2
      ╔═ [end of file] ═╗
    """
                .trimIndent())
  }

  @Test @Order(4)
  fun removingSelfieShrinksFile() {
    ut_mirror().linesFrom("fun one").toFirst("}").commentOut()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ two ═╗
      2
      ╔═ [end of file] ═╗
    """
                .trimIndent())
  }

  @Test @Order(5)
  fun removingAllSelfiesDeletesFile() {
    ut_mirror().linesFrom("fun two").toFirst("}").commentOut()
    gradleWriteSS()
    ut_snapshot().assertDoesNotExist()
  }
}
