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

import java.io.File

open class SelfieSettingsAPI {
  /**
   * It's possible that multiple codepaths from multiple tests can end up writing a single snapshot
   * to a single location. If these snapshots are different, you get a "snapshot error" within a
   * single invocation, so it can't be resolved by updating the snapshot.
   *
   * But if they're all writing the same value, it could be okay. By default, we allow this, but you
   * can disable it if you want to be more strict.
   */
  open val allowMultipleEquivalentWritesToOneLocation: Boolean
    get() = true

  /**
   * Defaults to `__snapshot__`, null means that snapshots are stored at the same folder location as
   * the test that created them.
   */
  open val snapshotFolderName: String?
    get() = null

  /** By default, the root folder is the first of the standard test directories. */
  open val rootFolder: File
    get() {
      val userDir = File(System.getProperty("user.dir"))
      for (standardDir in STANDARD_DIRS) {
        val candidate = userDir.resolve(standardDir)
        if (candidate.isDirectory) {
          return candidate
        }
      }
      throw AssertionError(
          "Could not find a standard test directory, 'user.dir' is equal to $userDir, looked in $STANDARD_DIRS")
    }

  internal companion object {
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/test/resources")
    internal fun initialize(): SelfieSettingsAPI {
      val settings = System.getProperty("selfie.settings")
      if (settings != null && settings.isNotBlank()) {
        try {
          return instantiate(Class.forName(settings))
        } catch (e: ClassNotFoundException) {
          throw Error(
              "The system property selfie.settings was set to $settings, but that class could not be found.",
              e)
        }
      }
      try {
        return instantiate(Class.forName("selfie.SelfieSettings"))
      } catch (e: ClassNotFoundException) {
        return SelfieSettingsAPI()
      }
    }
    private fun instantiate(clazz: Class<*>): SelfieSettingsAPI {
      try {
        return clazz.getDeclaredConstructor().newInstance() as SelfieSettingsAPI
      } catch (e: InstantiationException) {
        throw AssertionError(
            "Unable to instantiate ${clazz.name}, is it abstract? Does it require arguments?", e)
      }
    }
  }
}
