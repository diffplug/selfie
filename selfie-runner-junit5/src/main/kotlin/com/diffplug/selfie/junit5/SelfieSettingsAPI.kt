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
import com.diffplug.selfie.SnapshotPrism
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

interface SelfieSettingsAPI {
  fun openPrismTrain(layout: SnapshotFileLayout): SnapshotPrism

  /**
   * Defaults to `__snapshot__`, null means that snapshots are stored at the same folder location as
   * the test that created them.
   */
  val snapshotFolderName: String?
    get() = "__snapshots__"

  /** By default, the root folder is the first of the standard test directories. */
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
          "Could not find a standard test directory, 'user.dir' is equal to $userDir, looked in $STANDARD_DIRS")
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
        val clazz = Class.forName("com.diffplug.selfie.SelfieSettings")
        return clazz.getDeclaredConstructor().newInstance() as SelfieSettingsAPI
      } catch (e: ClassNotFoundException) {
        return SelfieSettingsNoOp
      } catch (e: InstantiationException) {
        throw AssertionError(
            "Unable to instantiate com.diffplug.SelfieSettings, is it abstract?", e)
      }
    }
  }
}

private object SelfieSettingsNoOp : SelfieSettingsAPI {
  override fun openPrismTrain(layout: SnapshotFileLayout): SnapshotPrism =
      object : SnapshotPrism {
        override fun transform(testClass: String, key: String, snapshot: Snapshot): Snapshot =
            snapshot
      }
}
