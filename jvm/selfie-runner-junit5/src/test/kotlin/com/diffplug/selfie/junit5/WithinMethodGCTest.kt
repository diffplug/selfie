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
class WithinMethodGCTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfiesNoFile() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
    ut_mirrorKt().lineWith("leaf").setContent("    expectSelfie(\"maple\").toMatchDisk(\"leaf\")")
    ut_mirrorKt().lineWith("abc").setContent("    expectSelfie(\"abc\").toMatchDisk()")
    ut_mirrorKt().linesFrom("UT_WithinMethodGC").toLast("}").shrinkByOne().commentOut()
  }

  @Test @Order(2)
  fun rootOnly() {
    ut_mirrorKt().linesFrom("fun selfie()").toFirst("}").uncomment()
    ut_mirrorKt().lineWith("leaf").commentOut()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ selfie ═╗
      root
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
  }

  @Test @Order(3)
  fun rootAndLeaf() {
    ut_mirrorKt().lineWith("leaf").uncomment()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ selfie ═╗
      root
      ╔═ selfie/leaf ═╗
      maple
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
  }

  @Test @Order(4)
  fun leafOnly() {
    ut_mirrorKt().lineWith("root").commentOut()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ selfie/leaf ═╗
      maple
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
  }

  @Test @Order(5)
  fun renameTheWholeMethod() {
    ut_mirrorKt().lineWith("selfie2()").uncomment()
    ut_mirrorKt().lineWith("selfie()").commentOut()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ selfie2/leaf ═╗
      maple
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
  }

  @Test @Order(6)
  fun addSecondMethod() {
    ut_mirrorKt().linesFrom("secondMethod()").toFirst("}").uncomment()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ secondMethod ═╗
      abc
      ╔═ selfie2/leaf ═╗
      maple
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
  }

  @Test @Order(7)
  fun runOnlyTheSecondTest() {
    runOnlyMethod = "secondMethod"
    ut_mirrorKt().lineWith("leaf").setContent("    expectSelfie(\"oak\").toMatchDisk(\"leaf\")")
    ut_mirrorKt().lineWith("abc").setContent("    expectSelfie(\"abc123\").toMatchDisk()")
    gradleWriteSS()
    // set leaf to oak, and secondMethod to 123, but selfie2/lead should remain maple since we
    // aren't running it
    ut_snapshot()
        .assertContent(
            """
      ╔═ secondMethod ═╗
      abc123
      ╔═ selfie2/leaf ═╗
      maple
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
    gradleReadSS()

    runOnlyMethod = null
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ secondMethod ═╗
      abc123
      ╔═ selfie2/leaf ═╗
      oak
      ╔═ [end of file] ═╗
      
    """
                .trimIndent())
    gradleReadSS()
  }
}
