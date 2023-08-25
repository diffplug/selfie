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

@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class ControlRW : Harness("undertest-junit5") {
  @Test @Order(1)
  fun noSelfiesNoFile() {
    ut_mirror().lineWith("apple").uncomment()
    ut_mirror().lineWith("orange").commentOut()
    gradlew("underTest").build()
    ut_snapshot()
        .assertContent(
            """
            blah            
        """
                .trimIndent())
  }
}
