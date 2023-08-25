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

import org.junit.platform.engine.TestExecutionResult
import org.junit.platform.engine.support.descriptor.ClassSource
import org.junit.platform.engine.support.descriptor.MethodSource
import org.junit.platform.launcher.TestExecutionListener
import org.junit.platform.launcher.TestIdentifier

class SelfieTestExecutionListener : TestExecutionListener {
  override fun executionStarted(testIdentifier: TestIdentifier) {
    val source = testIdentifier.source.orElse(null)
    when (source) {
      is ClassSource -> {
        println("start class ${source.className}")
      }
      is MethodSource -> {
        println("start method ${source.className}#${source.methodName}")
      }
      else -> throw IllegalArgumentException("Unknown source type ${testIdentifier.source.get()}")
    }
  }
  override fun executionSkipped(testIdentifier: TestIdentifier, reason: String) {
    println("skipped=${testIdentifier.displayName}")
  }
  override fun executionFinished(
      testIdentifier: TestIdentifier,
      testExecutionResult: TestExecutionResult
  ) {
    println("finished=${testIdentifier.displayName}")
  }
}
