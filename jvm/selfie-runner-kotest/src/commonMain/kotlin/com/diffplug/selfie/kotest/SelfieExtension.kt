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

import com.diffplug.selfie.guts.CoroutineDiskStorage
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.extensions.Extension
import io.kotest.core.extensions.TestCaseExtension
import io.kotest.core.listeners.AfterProjectListener
import io.kotest.core.listeners.FinalizeSpecListener
import io.kotest.core.source.SourceRef
import io.kotest.core.spec.Spec
import io.kotest.core.test.TestCase
import io.kotest.core.test.TestResult
import kotlin.reflect.KClass
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext

class SelfieExtension(projectConfig: AbstractProjectConfig) :
    Extension, TestCaseExtension, FinalizeSpecListener, AfterProjectListener {
  private fun snapshotFileFor(testCase: TestCase): SnapshotFileProgress {
    val classOrFilename: String =
        when (val source = testCase.source) {
          is SourceRef.ClassSource -> source.fqn
          is SourceRef.FileSource -> source.fileName
          is SourceRef.None -> TODO("Handle SourceRef.None")
        }
    return SnapshotSystemKotest.forClassOrFilename(classOrFilename)
  }
  /** Called for every test method. */
  override suspend fun intercept(
      testCase: TestCase,
      execute: suspend (TestCase) -> TestResult
  ): TestResult {
    val file = snapshotFileFor(testCase)
    val testName = testCase.name.testName
    val coroutineLocal = CoroutineDiskStorage(DiskStorageKotest(file, testName))
    return withContext(currentCoroutineContext() + coroutineLocal) {
      file.startTest(testName)
      val result = execute(testCase)
      file.finishedTestWithSuccess(testName, result.isSuccess)
      result
    }
  }
  override suspend fun finalizeSpec(
      kclass: KClass<out Spec>,
      results: Map<TestCase, TestResult>,
  ) {
    val file = results.keys.map { snapshotFileFor(it) }.firstOrNull() ?: return
    results.entries.forEach {
      if (it.value.isIgnored) {
        file.startTest(it.key.name.testName)
        file.finishedTestWithSuccess(it.key.name.testName, false)
      }
    }
    file.finishedClassWithSuccess(results.entries.all { it.value.isSuccess })
  }
  override suspend fun afterProject() {
    SnapshotSystemKotest.finishedAllTests()
  }
}
