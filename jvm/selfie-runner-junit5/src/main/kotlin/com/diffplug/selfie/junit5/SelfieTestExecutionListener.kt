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
  private val system = SnapshotSystemJUnit5
  override fun executionStarted(testIdentifier: TestIdentifier) {
    try {
      if (isRootOrKotest(testIdentifier)) return
      val (clazz, test) = parseClassTest(testIdentifier)
      val snapshotFile = system.forClass(clazz)
      if (test == null) {
        snapshotFile.incrementContainers()
      } else {
        system.forClass(clazz).startTest(test, true)
      }
    } catch (e: Throwable) {
      system.layout.smuggledError.set(e)
    }
  }
  override fun executionSkipped(testIdentifier: TestIdentifier, reason: String) {
    try {
      val (clazz, test) = parseClassTest(testIdentifier)
      if (test == null) {
        system.forClass(clazz).incrementContainers()
        system.forClass(clazz).decrementContainersWithSuccess(false)
      } else {
        // TODO: using reflection right now, but we should probably listen to these
      }
    } catch (e: Throwable) {
      system.layout.smuggledError.set(e)
    }
  }
  override fun executionFinished(
      testIdentifier: TestIdentifier,
      testExecutionResult: TestExecutionResult
  ) {
    try {
      if (isRootOrKotest(testIdentifier)) return
      val (clazz, test) = parseClassTest(testIdentifier)
      val isSuccess = testExecutionResult.status == TestExecutionResult.Status.SUCCESSFUL
      val snapshotFile = system.forClass(clazz)
      if (test == null) {
        snapshotFile.decrementContainersWithSuccess(isSuccess)
      } else {
        snapshotFile.finishedTestWithSuccess(test, true, isSuccess)
      }
    } catch (e: Throwable) {
      system.layout.smuggledError.set(e)
    }
  }
  override fun testPlanExecutionFinished(testPlan: TestPlan?) {
    system.finishedAllTests()
  }
  private fun isRootOrKotest(testIdentifier: TestIdentifier) =
      testIdentifier.parentId.isEmpty || testIdentifier.uniqueId.startsWith("[engine:kotest]")
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
