/*
 * Copyright (C) 2024 DiffPlug
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

import com.diffplug.selfie.Mode
import okio.Path
import okio.Path.Companion.toPath

internal expect fun readUserDir(): String

internal expect fun readEnvironmentVariable(name: String): String?
internal fun calcMode(): Mode {
  val override = readEnvironmentVariable("selfie") ?: readEnvironmentVariable("SELFIE")
  if (override != null) {
    return Mode.valueOf(override.lowercase())
  }
  val ci = readEnvironmentVariable("ci") ?: readEnvironmentVariable("CI")
  return if (ci?.lowercase() == "true") Mode.readonly else Mode.interactive
}

/**
 * To change the default settings, you must pass an instance of this class to the [SelfieExtension]
 * in its constructor. The magic class
 * [`selfie.SelfieSettings`](https://kdoc.selfie.dev/selfie-runner-junit5/com.diffplug.selfie.junit5/-selfie-settings-a-p-i/)
 * that `selfie-runner-junit5` uses does not work with the multiplatform in `selfie-runner-kotest`
 * - you have to pass the settings explicitly.
 */
open class SelfieSettingsAPI {
  /**
   * It's possible that multiple codepaths from multiple tests can end up writing a single snapshot
   * to a single location. If all these codepaths are writing the same value, it's fine. But it's a
   * bit of a problem waiting to happen, because if they start writing different values, we'll have
   * a "snapshot error" even within a single invocation, so it can't be resolved by updating the
   * snapshot. By default we let this happen and give a nice error message if it goes wrong, but you
   * can disallow it in the first place if you want.
   */
  open val allowMultipleEquivalentWritesToOneLocation: Boolean
    get() = true

  /**
   * Defaults to null, which means that snapshots are stored right next to the test that created
   * them. Set to `__snapshots__` to mimic Jest behavior.
   */
  open val snapshotFolderName: String?
    get() = null

  /**
   * By default, the root folder is the first of the standard test directories. All snapshots are
   * stored within the root folder.
   */
  open val rootFolder: Path
    get() {
      val userDir = readUserDir().toPath()
      for (standardDir in STANDARD_DIRS) {
        val candidate = userDir.resolve(standardDir)
        if (FS_SYSTEM.metadataOrNull(candidate)?.isDirectory == true) {
          return candidate
        }
      }
      throw AssertionError(
          "Could not find a standard test directory, 'user.dir' is equal to $userDir, looked in $STANDARD_DIRS")
    }

  /**
   * If Selfie should look for test sourcecode in places other than the rootFolder, you can specify
   * them here. Selfie will not store snapshots in these folders.
   */
  open val otherSourceRoots: List<Path>
    get() {
      return buildList {
        val rootDir = rootFolder
        val userDir = readUserDir().toPath()
        for (standardDir in STANDARD_DIRS) {
          val candidate = userDir.resolve(standardDir)
          if (FS_SYSTEM.metadataOrNull(candidate)?.isDirectory == true && candidate != rootDir) {
            add(candidate)
          }
        }
      }
    }

  internal companion object {
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/commonTest/kotlin",
            "src/jvmTest/kotlin",
            "src/jsTest/kotlin",
            "src/test/resources")
  }
}

internal class SelfieSettingsSmuggleError(val error: Throwable) : SelfieSettingsAPI() {}
