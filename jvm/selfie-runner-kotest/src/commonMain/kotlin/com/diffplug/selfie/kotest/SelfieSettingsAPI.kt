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

internal expect fun instantiateSettingsAt(name: String): SelfieSettingsAPI
internal fun calcMode(): Mode {
  val override = readEnvironmentVariable("selfie") ?: readEnvironmentVariable("SELFIE")
  if (override != null) {
    return Mode.valueOf(override.lowercase())
  }
  val ci = readEnvironmentVariable("ci") ?: readEnvironmentVariable("CI")
  return if (ci?.lowercase() == "true") Mode.readonly else Mode.interactive
}

/**
 * If you create a class named `SelfieSettings` in the package `selfie`, it must extend this class,
 * and you can override the methods below to customize various behaviors of selfie. You can also put
 * the settings class somewhere else if you set the `selfie.settings` system property to the fully
 * qualified name of the class you want selfie to use.
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
    internal fun initialize(): SelfieSettingsAPI {
      try {
        val settings = readEnvironmentVariable("SELFIE_SETTINGS")
        if (settings != null && settings.isNotBlank()) {
          try {
            return instantiateSettingsAt(settings)
          } catch (e: Throwable) {
            throw Error(
                "The system property selfie.settings was set to $settings, but that class could not be found.",
                e)
          }
        }
        try {
          return instantiateSettingsAt("selfie.SelfieSettings")
        } catch (e: Throwable) {
          return SelfieSettingsAPI()
        }
      } catch (e: Throwable) {
        return SelfieSettingsSmuggleError(e)
      }
    }
  }
}

class SelfieSettingsSmuggleError(val error: Throwable) : SelfieSettingsAPI() {}
