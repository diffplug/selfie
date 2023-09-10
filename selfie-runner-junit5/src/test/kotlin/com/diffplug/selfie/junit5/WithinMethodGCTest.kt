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
import org.junitpioneer.jupiter.DisableIfTestFails

/** Write-only test which asserts adding and removing snapshots results in same-class GC. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class WithinMethodGCTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfiesNoFile() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
    ut_mirror().linesFrom("UT_WithinMethodGC").toLast("}").shrinkByOne().commentOut()
  }

  @Test @Order(2)
  fun rootOnly() {
    ut_mirror().linesFrom("fun selfie()").toFirst("}").uncomment()
    ut_mirror().lineWith("maple").commentOut()
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
    ut_mirror().lineWith("maple").uncomment()
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
    ut_mirror().lineWith("root").commentOut()
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
    ut_mirror().lineWith("selfie2()").uncomment()
    ut_mirror().lineWith("selfie()").commentOut()
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
  fun resetUTMirror() {
    ut_mirror().lineWith("root").uncomment()
    ut_mirror().lineWith("selfie2()").commentOut()
    ut_mirror().lineWith("selfie()").uncomment()
  }
}
