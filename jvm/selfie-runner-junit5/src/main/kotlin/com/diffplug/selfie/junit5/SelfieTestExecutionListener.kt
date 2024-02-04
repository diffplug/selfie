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
      val (clazz, test) = parseClassTest(testIdentifier)
      if (test != null) {
        progress.forClass(clazz).startTest(test)
      }
    } catch (e: Throwable) {
      progress.layout.smuggledError = e
    }
  }
  override fun executionSkipped(testIdentifier: TestIdentifier, reason: String) {
    try {
      val (clazz, test) = parseClassTest(testIdentifier)
      if (test == null) {
        progress.forClass(clazz).finishedClassWithSuccess(false)
      } else {
        // TODO: using reflection right now, but we should probably listen to these
      }
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
      val (clazz, test) = parseClassTest(testIdentifier)
      val isSuccess = testExecutionResult.status == TestExecutionResult.Status.SUCCESSFUL
      val snapshotProgress = progress.forClass(clazz)
      if (test != null) {
        snapshotProgress.finishedTestWithSuccess(test, isSuccess)
      } else {
        snapshotProgress.finishedClassWithSuccess(isSuccess)
      }
    } catch (e: Throwable) {
      progress.layout.smuggledError = e
    }
  }
  override fun testPlanExecutionFinished(testPlan: TestPlan?) {
    progress.finishedAllTests()
  }
  private fun isRoot(testIdentifier: TestIdentifier) = testIdentifier.parentId.isEmpty
  private fun parseClassTest(testIdentifier: TestIdentifier): Pair<String, String?> {
    return when (val source = testIdentifier.source.get()) {
      is ClassSource ->
          Pair(source.className, if (testIdentifier.isTest) testIdentifier.displayName else null)
      is MethodSource ->
          Pair(source.className, if (testIdentifier.isTest) source.methodName else null)
      else -> throw AssertionError("Unexpected source $source")
    }
  }
}
