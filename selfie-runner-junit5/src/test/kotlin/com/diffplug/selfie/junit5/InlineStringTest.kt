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

/** Write-only test which asserts adding and removing snapshots results in same-class GC. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
// @DisableIfTestFails don't disable if test fails because we *have* to run cleanup
class InlineStringTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun toBe_TODO() {
    ut_mirror().lineWith("@Ignore").setContent("//@Ignore")
    ut_mirror().lineWith("expectSelfie").setContent("    expectSelfie(\"Hello world\").toBe_TODO()")
    gradleReadSSFail()
  }

  @Test @Order(2)
  fun toBe_write() {
    gradleWriteSS()
    ut_mirror().lineWith("expectSelfie").content() shouldBe
        "    expectSelfie(\"Hello world\").toBe(\"Hello world\")"
    gradleReadSS()
  }

  @Test @Order(3)
  fun cleanup() {
    ut_mirror().lineWith("expectSelfie").setContent("    expectSelfie(\"Hello world\").toBe_TODO()")
    ut_mirror().lineWith("//@Ignore").setContent("@Ignore")
  }
}
