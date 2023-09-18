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

import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SnapshotValue

interface SnapshotPipe : AutoCloseable {
  fun transform(
      testClass: Class<*>,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): Snapshot
}

interface SnapshotLens : AutoCloseable {
  val defaultLensName: String
  fun transform(
      testClass: Class<*>,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): SnapshotValue?
  override fun close() {
    // optional
  }
}

class PipeWhere : SnapshotPipe {
  private val toApply = mutableListOf<SnapshotPipe>()
  private fun addLensOrReplaceRoot(name: String?, lens: SnapshotLens) {
    toApply.add(
        object : SnapshotPipe {
          override fun transform(
              testClass: Class<*>,
              key: String,
              callStack: CallStack,
              snapshot: Snapshot
          ): Snapshot {
            var lensValue: SnapshotValue?
            try {
              lensValue = lens.transform(testClass, key, callStack, snapshot)
            } catch (e: Throwable) {
              lensValue = SnapshotValue.of(e.stackTraceToString())
            }
            return if (lensValue == null) snapshot
            else {
              if (name == null) snapshot.withNewRoot(lensValue) else snapshot.lens(name, lensValue)
            }
          }
          override fun close() = lens.close()
        })
  }
  fun addLens(name: String, lens: SnapshotLens) = addLensOrReplaceRoot(name, lens)
  fun addLens(lens: SnapshotLens) = addLensOrReplaceRoot(lens.defaultLensName, lens)
  fun replaceRootWith(lens: SnapshotLens) = addLensOrReplaceRoot(null, lens)
  override fun transform(
      testClass: Class<*>,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): Snapshot {
    var current = snapshot
    toApply.forEach { current = it.transform(testClass, key, callStack, snapshot) }
    return current
  }
  override fun close() {
    toApply.forEach { it.close() }
  }
}

interface SelfieSettingsAPI {
  fun openPipeline(layout: SnapshotFileLayout): SnapshotPipe
}

open class StandardSelfieSettings : SelfieSettingsAPI {
  private val pipes = mutableListOf<PipeWhere>()
  protected fun addPipeWhere(): PipeWhere {
    val newPipe = PipeWhere()
    pipes.add(newPipe)
    return newPipe
  }
  override fun openPipeline(layout: SnapshotFileLayout): SnapshotPipe {
    TODO("Not yet implemented")
  }
}

class Example : StandardSelfieSettings() {
  init {
      addPipeWhere().addLens()
  }
}
