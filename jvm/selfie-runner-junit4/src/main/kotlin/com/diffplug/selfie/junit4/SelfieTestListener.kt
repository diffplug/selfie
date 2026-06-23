/*
 * Copyright (C) 2024-2025 DiffPlug
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
package com.diffplug.selfie.junit4

import org.junit.runner.Description
import org.junit.runner.notification.Failure
import org.junit.runner.notification.RunListener

/** This is automatically registered at runtime thanks to `META-INF/services`. */
class SelfieTestListener : RunListener() {
  private val system = SnapshotSystemJUnit4
  private val activeTests = mutableMapOf<String, Boolean>()
  override fun testStarted(description: Description) {
    try {
      system.testListenerRunning.set(true)
      val className = description.className
      val testName = description.methodName
      val key = "$className#$testName"
      activeTests[key] = true
      system.forClass(className).startTest(testName, false)
    } catch (e: Throwable) {
      system.smuggledError.set(e)
    }
  }
  override fun testFinished(description: Description) {
    try {
      val className = description.className
      val testName = description.methodName
      val key = "$className#$testName"
      val wasSuccessful = activeTests.remove(key) ?: false
      system.forClass(className).finishedTestWithSuccess(testName, false, wasSuccessful)
    } catch (e: Throwable) {
      system.smuggledError.set(e)
    }
  }
  override fun testFailure(failure: Failure) {
    val description = failure.description
    val key = "${description.className}#${description.methodName}"
    activeTests[key] = false
  }
  override fun testRunFinished(result: org.junit.runner.Result) {
    system.finishedAllTests()
  }
}
