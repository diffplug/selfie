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

import com.diffplug.selfie.expectSelfie
import kotlin.test.Ignore
import kotlin.test.Test
import org.junit.jupiter.api.extension.ExtendWith

@Ignore
@ExtendWith(SelfieExtension::class)
class NoEscapingNeeded {
  @Test
  fun _00_empty() {
    expectSelfie("").toMatchDisk()
  }

  @Test
  fun _01_singleLineString() {
    expectSelfie("this is one line").toMatchDisk()
  }

  @Test
  fun _01a_singleLineLeadingSpace() {
    expectSelfie(" the leading space is significant").toMatchDisk()
  }

  @Test
  fun _01b_singleLineTrailingSpace() {
    expectSelfie("the trailing space is significant ").toMatchDisk()
  }

  @Test
  fun _02_multiLineStringTrimmed() {
    expectSelfie("Line 1\nLine 2").toMatchDisk()
  }
}
