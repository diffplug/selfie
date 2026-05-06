/*
 * Copyright (C) 2026 DiffPlug
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

@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@DisableIfTestFails
class CustomAnnotationGCTest : HarnessJUnit() {

  @Test @Order(1)
  fun setup() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
  }

  @Test @Order(2)
  fun writeBothSnapshots() {
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ withCustomAnnotation ═╗
      custom
      ╔═ withStandardAnnotation ═╗
      standard
      ╔═ [end of file] ═╗

    """
                .trimIndent())
  }

  @Test @Order(3)
  fun defaultSettingsPrunesCustomAnnotationSnapshot() {
    // Run only withStandardAnnotation. Selfie doesn't recognize @MyTest by default.
    // Its snapshot has no gc entry and is treated as an orphan → pruned.
    runOnlyMethod = "withStandardAnnotation"
    gradleWriteSS()
    runOnlyMethod = null
    ut_snapshot()
        .assertContent(
            """
      ╔═ withStandardAnnotation ═╗
      standard
      ╔═ [end of file] ═╗

    """
                .trimIndent())
  }

  @Test @Order(4)
  fun writeBothSnapshotsAgain() {
    gradleWriteSS()
    ut_snapshot()
        .assertContent(
            """
      ╔═ withCustomAnnotation ═╗
      custom
      ╔═ withStandardAnnotation ═╗
      standard
      ╔═ [end of file] ═╗

    """
                .trimIndent())
  }

  @Test @Order(5)
  fun customSettingsPreservesCustomAnnotationSnapshot() {
    // Run only withStandardAnnotation. With SelfieSettingsWithMyTest, selfie knows @MyTest is a
    // test annotation. Its snapshot is kept.
    runOnlyMethod = "withStandardAnnotation"
    gradlew(
            "test",
            "-PunderTest=true",
            "-Pselfie=overwrite",
            "-Pselfie.settings=undertest.junit5.SelfieSettingsWithMyTest")
        ?.let {
          throw AssertionError(
              "Expected overwrite with custom settings to succeed, but it failed", it)
        }
    runOnlyMethod = null
    ut_snapshot()
        .assertContent(
            """
      ╔═ withCustomAnnotation ═╗
      custom
      ╔═ withStandardAnnotation ═╗
      standard
      ╔═ [end of file] ═╗

    """
                .trimIndent())
  }

  @Test @Order(6)
  fun cleanup() {
    ut_snapshot().deleteIfExists()
    ut_snapshot().assertDoesNotExist()
  }
}
