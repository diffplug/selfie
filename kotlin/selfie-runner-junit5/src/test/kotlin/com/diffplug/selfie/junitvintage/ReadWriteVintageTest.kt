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
package com.diffplug.selfie.junitvintage

import com.diffplug.selfie.junit5.Harness
import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

/** Simplest test for verifying read/write of a snapshot. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class ReadWriteVintageTest : Harness("undertest-junit-vintage") {
  @Test @Order(1)
  fun noSelfie() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
  }

  @Test @Order(2)
  fun writeApple() {
    ut_mirror().lineWith("apple").uncomment()
    ut_mirror().lineWith("orange").commentOut()
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
            ╔═ selfie ═╗
            apple
            ╔═ [end of file] ═╗
            
        """
                .trimIndent())
  }

  @Test @Order(3)
  fun assertApplePasses() {
    gradleReadSS()
  }

  @Test @Order(4)
  fun assertOrangeFails() {
    ut_mirror().lineWith("apple").commentOut()
    ut_mirror().lineWith("orange").uncomment()
    gradleReadSSFail()
    ut_snapshot()
        .assertContent(
            """
            ╔═ selfie ═╗
            apple
            ╔═ [end of file] ═╗
            
        """
                .trimIndent())
  }

  @Test @Order(5)
  fun writeOrange() {
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
            ╔═ selfie ═╗
            orange
            ╔═ [end of file] ═╗
            
        """
                .trimIndent())
  }
}
