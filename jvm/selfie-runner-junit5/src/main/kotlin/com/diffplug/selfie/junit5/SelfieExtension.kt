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

import com.diffplug.selfie.guts.CoroutineDiskStorage
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.extensions.Extension
import io.kotest.core.extensions.TestCaseExtension
import io.kotest.core.listeners.AfterProjectListener
import io.kotest.core.listeners.BeforeSpecListener
import io.kotest.core.listeners.FinalizeSpecListener
import io.kotest.core.spec.Spec
import io.kotest.core.test.TestCase
import io.kotest.core.test.TestResult
import kotlin.reflect.KClass
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext

class SelfieExtension(projectConfig: AbstractProjectConfig) :
    Extension, BeforeSpecListener, TestCaseExtension, FinalizeSpecListener, AfterProjectListener {
  override suspend fun beforeSpec(spec: Spec) {
    SnapshotSystemJUnit5.forClass(spec.javaClass.name).incrementContainers()
  }
  override suspend fun intercept(
      testCase: TestCase,
      execute: suspend (TestCase) -> TestResult
  ): TestResult {
    val file = SnapshotSystemJUnit5.forClass(testCase.spec::class.java.name)
    val coroutineLocal = CoroutineDiskStorage(DiskStorageJUnit5(file, testCase.name.testName))
    return withContext(currentCoroutineContext() + coroutineLocal) {
      file.startTest(testCase.name.testName, false)
      val result = execute(testCase)
      file.finishedTestWithSuccess(testCase.name.testName, false, result.isSuccess)
      result
    }
  }
  override suspend fun finalizeSpec(
      kclass: KClass<out Spec>,
      results: Map<TestCase, TestResult>,
  ) {
    val file = SnapshotSystemJUnit5.forClass(kclass.java.name)
    results.entries.forEach {
      if (it.value.isIgnored) {
        file.startTest(it.key.name.testName, false)
        file.finishedTestWithSuccess(it.key.name.testName, false, false)
      }
    }
    SnapshotSystemJUnit5.forClass(kclass.java.name)
        .decrementContainersWithSuccess(results.values.all { it.isSuccess })
  }
  /**
   * If you run from the CLI, `SelfieTestExecutionListener` will run and so will `afterProject`
   * below If you run using the Kotest IDE plugin
   * - if you run a whole spec, `SelfieTestExecutionListener` will run and so will `afterProject`
   *   below
   * - if you run a single test, `SelfieTestExecutionListener` will not run, but `afterProject`
   *   below will
   */
  override suspend fun afterProject() {
    SnapshotSystemJUnit5.finishedAllTests()
  }
}
