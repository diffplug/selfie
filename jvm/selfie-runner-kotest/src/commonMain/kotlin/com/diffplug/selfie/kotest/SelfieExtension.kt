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

import com.diffplug.selfie.guts.DiskStorage
import io.kotest.core.extensions.Extension
import io.kotest.core.extensions.TestCaseExtension
import io.kotest.core.listeners.AfterProjectListener
import io.kotest.core.listeners.FinalizeSpecListener
import io.kotest.core.listeners.IgnoredSpecListener
import io.kotest.core.source.SourceRef
import io.kotest.core.spec.Spec
import io.kotest.core.test.TestCase
import io.kotest.core.test.TestResult
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.reflect.KClass
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext

internal class CoroutineDiskStorage(val disk: DiskStorage) : AbstractCoroutineContextElement(Key) {
  override val key = Key

  companion object Key : CoroutineContext.Key<CoroutineDiskStorage>
}

object SelfieExtension :
    Extension, FinalizeSpecListener, TestCaseExtension, IgnoredSpecListener, AfterProjectListener {
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
  private fun snapshotFileFor(testCase: TestCase): SnapshotFileProgress {
    val clazz: String =
        when (val source = testCase.source) {
          is SourceRef.ClassSource -> source.fqn
          is SourceRef.FileSource -> TODO("Handle SourceRef.FileSource")
          is SourceRef.None -> TODO("Handle SourceRef.None")
        }
    return SnapshotSystemKotest.forClass(clazz)
  }
  override suspend fun finalizeSpec(
      kclass: KClass<out Spec>,
      results: Map<TestCase, TestResult>,
  ) {
    results.keys
        .map { snapshotFileFor(it) }
        .firstOrNull()
        ?.let { file -> file.finishedClassWithSuccess(results.values.all { it.isSuccess }) }
  }
  override suspend fun ignoredSpec(kclass: KClass<*>, reason: String?): Unit = Unit
  override suspend fun afterProject() {
    SnapshotSystemKotest.finishedAllTests()
  }
}
