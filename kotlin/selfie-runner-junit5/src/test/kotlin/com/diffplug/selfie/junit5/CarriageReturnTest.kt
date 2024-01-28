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

/** Verify selfie's carriage-return handling. */
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class CarriageReturnTest : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfie() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
  }
  val expectedContent =
      """
            ╔═ git_makes_carriage_returns_unrepresentable ═╗
            hard
            to
            preserve
            this
            
            ╔═ [end of file] ═╗
            
        """
          .trimIndent()

  @Test @Order(2)
  fun write_and_assert_ss_has_unix_newlines() {
    gradleWriteSS()
    ut_snapshot().assertContent(expectedContent)
  }

  @Test @Order(3)
  fun if_ss_has_cr_then_it_will_stay_cr() {
    val contentWithCr = expectedContent.replace("\n", "\r\n")
    ut_snapshot().setContent(contentWithCr)
    gradleWriteSS()
    ut_snapshot().assertContent(contentWithCr)
  }

  @Test @Order(4)
  fun go_back_to_unix_and_it_stays_unix() {
    ut_snapshot().setContent(expectedContent)
    gradleWriteSS()
    ut_snapshot().assertContent(expectedContent)
  }
}
