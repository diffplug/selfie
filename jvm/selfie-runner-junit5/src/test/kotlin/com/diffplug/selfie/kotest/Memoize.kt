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
package com.diffplug.selfie.kotest

import com.diffplug.selfie.junit5.HarnessJUnit
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

@Tag("kotest")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class Memoize : HarnessJUnit() {
  companion object {
    private var nanoTimeUnset: String = ""
    private var nanoTimeFirstSet: String = ""
  }
  private fun nanoTimeFunc() = ut_mirrorKt().linesFrom("nanoTimeTest").toLast("}").content()

  @Test @Order(1)
  fun initialState() {
    ut_mirrorKt().restoreFromGit()
    gradleReadSSFail()
    nanoTimeUnset = nanoTimeFunc()
  }

  @Test @Order(2)
  fun writeSucceeds() {
    gradleWriteSS()
    nanoTimeFirstSet = nanoTimeFunc()
    nanoTimeFirstSet shouldNotBe nanoTimeUnset
  }

  @Test @Order(3)
  fun readSucceedsNoChange() {
    gradleReadSS()
    nanoTimeFunc() shouldBe nanoTimeFirstSet
  }

  @Test @Order(4)
  fun writeChangesSnapshot() {
    gradleWriteSS()
    nanoTimeFunc() shouldNotBe nanoTimeFirstSet
    nanoTimeFunc() shouldNotBe nanoTimeUnset
  }

  @Test @Order(5)
  fun cleanup() {
    ut_mirrorKt().restoreFromGit()
  }
}
