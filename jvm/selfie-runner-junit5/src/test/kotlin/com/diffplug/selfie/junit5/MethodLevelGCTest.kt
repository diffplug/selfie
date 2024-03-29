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
package com.diffplug.selfie.junit5

import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

/** Write-only test which asserts adding and removing snapshots results in same-class GC. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class MethodLevelGCTest : HarnessJUnit() {
  @Test @Order(1)
  fun noSelfiesNoFile() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
    ut_mirrorKt().linesFrom("UT_MethodLevelGC").toLast("}").shrinkByOne().commentOut()
  }

  @Test @Order(2)
  fun firstSelfieCreatesFile() {
    ut_mirrorKt().linesFrom("fun one").toFirst("}").uncomment()
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
    ut_mirrorKt().linesFrom("fun two").toFirst("}").uncomment()
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
    ut_mirrorKt().linesFrom("fun one").toFirst("}").commentOut()
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
    ut_mirrorKt().linesFrom("fun two").toFirst("}").commentOut()
    gradleWriteSS()
    ut_snapshot().assertDoesNotExist()
  }
}
