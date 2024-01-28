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
package com.diffplug.selfie.junit5

import io.kotest.matchers.shouldBe
import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class ReadOnlyTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun initialState() {
    ut_mirror().lineWith("expectSelfie(").setContent("    expectSelfie(10).toBe(10)")
    gradleReadSS()
  }

  @Test @Order(2)
  fun inlineMismatchWithComment() {
    ut_mirror().lineWith("expectSelfie(").setContent("    expectSelfie(10).toBe(5) //SELFIEWRITE")
    gradleReadSSFail().message shouldBe
        "Selfie is in readonly mode, so `//SELFIEWRITE` is illegal at undertest.junit5.UT_ReadOnlyTest.<unknown>(UT_ReadOnlyTest.kt:9)"
  }

  @Test @Order(3)
  fun inlineMatchWithComment() {
    ut_mirror().lineWith("expectSelfie(").setContent("    expectSelfie(5).toBe(5) // selfieonce")
    gradleReadSSFail().message shouldBe
        "Selfie is in readonly mode, so `//selfieonce` is illegal at undertest.junit5.UT_ReadOnlyTest.<unknown>(UT_ReadOnlyTest.kt:9)"
  }
}
