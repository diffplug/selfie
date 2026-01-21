/*
 * Copyright (C) 2024-2026 DiffPlug
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
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.atomic
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.extensions.Extension
import io.kotest.core.extensions.TestCaseExtension
import io.kotest.core.listeners.AfterProjectListener
import io.kotest.core.listeners.FinalizeSpecListener
import io.kotest.core.source.SourceRef
import io.kotest.core.spec.Spec
import io.kotest.core.test.TestCase
import io.kotest.engine.test.TestResult
import kotlin.jvm.JvmStatic
import kotlin.reflect.KClass
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext

/**
 * Add this to your [AbstractProjectConfig], see [here](https://selfie.dev/jvm/kotest) for
 * high-level docs.
 */
class SelfieExtension(
    projectConfig: AbstractProjectConfig,
    settingsAPI: SelfieSettingsAPI = SelfieSettingsAPI()
) : Extension, TestCaseExtension, FinalizeSpecListener, AfterProjectListener {
  private val system = SnapshotSystemKotest(settingsAPI)

  companion object {
    private val snapshotSystem = atomic(null as SnapshotSystem?)

    @JvmStatic
    fun initStorage(): SnapshotSystem =
        snapshotSystem.get()
            ?: throw IllegalStateException(
                "SelfieExtension wasn't added to the AbstractProjectConfig")
  }

  init {
    snapshotSystem.updateAndGet {
      require(it == null) { "SnapshotSystemKotest should only be initialized once" }
      system
    }
  }
  private fun snapshotFileFor(testCase: TestCase): SnapshotFileProgress {
    val classOrFilename: String =
        when (val source = testCase.source) {
          is SourceRef.ClassSource -> source.fqn
          is SourceRef.ClassLineSource -> source.fqn
          is SourceRef.None -> TODO("Handle SourceRef.None")
        }
    return system.forClassOrFilename(classOrFilename)
  }

  /** Called for every test method. */
  override suspend fun intercept(
      testCase: TestCase,
      execute: suspend (TestCase) -> TestResult
  ): TestResult {
    val file = snapshotFileFor(testCase)
    val testName = testCase.name.name
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
        file.startTest(it.key.name.name)
        file.finishedTestWithSuccess(it.key.name.name, false)
      }
    }
    file.finishedClassWithSuccess(results.entries.all { it.value.isSuccess })
  }
  override suspend fun afterProject() {
    system.finishedAllTests()
  }
}
