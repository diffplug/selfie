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
import io.kotest.matchers.string.shouldContain
import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class DiskTodo : Harness("undertest-junit5") {
  companion object {
    var lineNoArg = ""
    var constantArg = ""
    var variableArg = ""
  }

  @Test @Order(1)
  fun initialState() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()

    lineNoArg = ut_mirror().lineWith("noArg").content()
    constantArg = ut_mirror().lineWith("constantArg").content()
    variableArg = ut_mirror().lineWith("variableArg").content()

    lineNoArg shouldContain "_TODO"
    constantArg shouldContain "_TODO"
    variableArg shouldContain "_TODO"
  }

  @Test @Order(2)
  fun writeRemovesTODO() {
    gradleWriteSS()
    ut_mirror().lineWith("noArg").content() shouldBe lineNoArg.replace("_TODO", "")
    ut_mirror().lineWith("constantArg").content() shouldBe constantArg.replace("_TODO", "")
    ut_mirror().lineWith("variableArg").content() shouldBe variableArg.replace("_TODO", "")
  }

  @Test @Order(3)
  fun nowItPasses() {
    gradleReadSS()
  }

  @Test @Order(4)
  fun ifTodoComesBackItDoesntPass() {
    ut_mirror().lineWith("noArg").setContent(lineNoArg)
    ut_mirror().lineWith("constantArg").setContent(constantArg)
    ut_mirror().lineWith("variableArg").setContent(variableArg)
    gradleReadSSFail()
  }

  @Test @Order(5)
  fun cleanup() {
    ut_snapshot().deleteIfExists()
  }
}
