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

import io.kotest.matchers.shouldBe

class HarnessVerifyTest : HarnessKotest() {
  private var initialContent: String = ""

  init {
    "initialize" {
      ut_mirrorKt().restoreFromGit()
      initialContent = ut_mirrorKt().linesFrom("UT_HarnessVerifyTest").toLast("}").content()
    }
    "runAll" { gradleInteractivePass() }
    "uncommentFailure" {
      ut_mirrorKt().linesFrom("alwaysFails()").toFirst("}").uncomment()
      gradleInteractiveFail()
    }
    "restoreInitial" {
      ut_mirrorKt().restoreFromGit()
      val actualContent = ut_mirrorKt().linesFrom("UT_HarnessVerifyTest").toLast("}").content()
      actualContent shouldBe initialContent
    }
  }
}
