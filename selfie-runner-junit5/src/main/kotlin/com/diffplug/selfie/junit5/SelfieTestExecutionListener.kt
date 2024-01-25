/*
 * Copyright (C) 2023-2024 DiffPlug
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
import org.junit.platform.launcher.TestPlan

/** This is automatically registered at runtime thanks to `META-INF/services`. */
class SelfieTestExecutionListener : TestExecutionListener {
  private val progress = Progress()
  override fun executionStarted(testIdentifier: TestIdentifier) {
    try {
      if (isRoot(testIdentifier)) return
      val (clazz, method) = parseClassMethod(testIdentifier)
      progress.start(clazz, method, testIdentifier.isTest)
    } catch (e: Throwable) {
      progress.layout.smuggledError = e
    }
  }
  override fun executionSkipped(testIdentifier: TestIdentifier, reason: String) {
    try {
      val (clazz, method) = parseClassMethod(testIdentifier)
      progress.skip(clazz, method, testIdentifier.isTest)
    } catch (e: Throwable) {
      progress.layout.smuggledError = e
    }
  }
  override fun executionFinished(
      testIdentifier: TestIdentifier,
      testExecutionResult: TestExecutionResult
  ) {
    try {
      if (isRoot(testIdentifier)) return
      val (clazz, method) = parseClassMethod(testIdentifier)
      progress.finishWithSuccess(
          clazz,
          method,
          testIdentifier.isTest,
          testExecutionResult.status == TestExecutionResult.Status.SUCCESSFUL)
    } catch (e: Throwable) {
      progress.layout.smuggledError = e
    }
  }
  override fun testPlanExecutionFinished(testPlan: TestPlan?) {
    progress.finishedAllTests()
  }
  private fun isRoot(testIdentifier: TestIdentifier) = testIdentifier.parentId.isEmpty
  private fun parseClassMethod(testIdentifier: TestIdentifier): Pair<String, String?> {
    return when (val source = testIdentifier.source.get()) {
      is ClassSource -> Pair(source.className, null)
      is MethodSource -> Pair(source.className, source.methodName)
      else -> throw AssertionError("Unexpected source $source")
    }
  }
}
