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
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

interface SelfieSettingsAPI {
  fun openPipeline(layout: SnapshotFileLayout): SnapshotPipe = SnapshotPipeNoOp

  /**
   * null means that snapshots are stored at the same folder location as the test that created them.
   */
  val snapshotFolderName: String?
    get() = "__snapshots__"
  val rootFolder: Path
    get() {
      val userDir = Paths.get(System.getProperty("user.dir"))
      for (standardDir in STANDARD_DIRS) {
        val candidate = userDir.resolve(standardDir)
        if (Files.isDirectory(candidate)) {
          return candidate
        }
      }
      throw AssertionError(
          "Could not find a standard test directory, 'user.dir' is equal to $userDir")
    }

  companion object {
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/test/resources")
    internal fun initialize(): SelfieSettingsAPI {
      try {
        val clazz = Class.forName("com.diffplug.selfie.SelfiePipeline")
        return clazz.getDeclaredConstructor().newInstance() as SelfieSettingsAPI
      } catch (e: ClassNotFoundException) {
        return StandardSelfieSettings()
      }
    }
  }
}

/** Transforms a full snapshot into a new snapshot. */
interface SnapshotPipe : AutoCloseable {
  fun transform(
      testClass: Class<*>,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): Snapshot
}

object SnapshotPipeNoOp : SnapshotPipe {
  override fun transform(
      testClass: Class<*>,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ) = snapshot
  override fun close() {}
}

/** Extracts a specific value out of an existing snapshot. */
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
    addPipeWhere()
  }
}
