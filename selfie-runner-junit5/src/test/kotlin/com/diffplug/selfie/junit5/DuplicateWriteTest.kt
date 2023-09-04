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

import io.kotest.matchers.shouldBe
import kotlin.test.Test
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.TestMethodOrder
import org.junitpioneer.jupiter.DisableIfTestFails

/** Simplest test for verifying read/write of a snapshot. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class DuplicateWriteTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfie() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
  }

  @Test @Order(2)
  fun cannot_write_multiple_things_to_one_snapshot() {
    ut_mirror().linesFrom("fun shouldFail()").toFirst("}").uncomment()
    ut_mirror().linesFrom("fun shouldPass()").toFirst("}").commentOut()
    gradlew("underTest", "-Pselfie=write")?.printStackTrace()
  }

  @Test @Order(3)
  fun can_write_one_thing_multiple_times_to_one_snapshot() {
    ut_mirror().linesFrom("fun shouldFail()").toFirst("}").commentOut()
    ut_mirror().linesFrom("fun shouldPass()").toFirst("}").uncomment()
    gradlew("underTest", "-Pselfie=write") shouldBe null
  }

  @Test @Order(4)
  fun can_read_one_thing_multiple_times_from_one_snapshot() {
    ut_mirror().linesFrom("fun shouldFail()").toFirst("}").commentOut()
    ut_mirror().linesFrom("fun shouldPass()").toFirst("}").uncomment()
    gradlew("underTest", "-Pselfie=read") shouldBe null
  }

  @Test @Order(5)
  fun writeonce_mode() {
    ut_mirror().linesFrom("fun shouldFail()").toFirst("}").commentOut()
    ut_mirror().linesFrom("fun shouldPass()").toFirst("}").uncomment()
    gradlew("underTest", "-Pselfie=writeonce")?.printStackTrace()
  }

  @Test @Order(6)
  fun deleteSelfie() {
    ut_snapshot().deleteIfExists()
  }
}
