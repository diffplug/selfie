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

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.ConcurrentHashMap

object SnapshotSystemJUnit4 {
  val testListenerRunning = AtomicBoolean(false)
  val smuggledError = AtomicReference<Throwable>()
  private val fileLayouts = ConcurrentHashMap<String, SnapshotFileLayoutJUnit4>()

  fun forClass(className: String): SnapshotFileLayoutJUnit4 {
    return fileLayouts.computeIfAbsent(className) { SnapshotFileLayoutJUnit4(it) }
  }

  fun finishedAllTests() {
    testListenerRunning.set(false)
    fileLayouts.clear()
  }

  fun checkForSmuggledError() {
    smuggledError.get()?.let { throw it }
  }
}
