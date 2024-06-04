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

import com.diffplug.selfie.Mode
import java.io.File
private fun lowercaseFromEnvOrSys(key: String): String? {
  val env = System.getenv(key)?.lowercase()
  if (!env.isNullOrEmpty()) {
    return env
  }
  val system = System.getProperty(key)?.lowercase()
  if (!system.isNullOrEmpty()) {
    return system
  }
  return null
}
internal fun calcMode(): Mode {
  val override = lowercaseFromEnvOrSys("selfie") ?: lowercaseFromEnvOrSys("SELFIE")
  if (override != null) {
    return Mode.valueOf(override)
  }
  val ci = lowercaseFromEnvOrSys("ci") ?: lowercaseFromEnvOrSys("CI")
  return if (ci == "true") Mode.readonly else Mode.interactive
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

  /**
   * If Selfie should look for test sourcecode in places other than the rootFolder, you can specify
   * them here. Selfie will not store snapshots in these folders.
   */
  open val otherSourceRoots: List<File>
    get() {
      return buildList {
        val rootDir = rootFolder
        val userDir = File(System.getProperty("user.dir"))
        for (standardDir in STANDARD_DIRS) {
          val candidate = userDir.resolve(standardDir)
          if (candidate.isDirectory && candidate != rootDir) {
            add(candidate)
          }
        }
      }
    }

  /**
   * By default, Selfie will encode multiline strings using triple quotes if the runtime supports
   * it, or it will use comma-delimited single-quote strings if the runtime doesn't. This can cause
   * a problem if you develop on Java 17 (and generate `toBe` assertions there) and then run your
   * tests in CI on Java 11.
   *
   * <p>
   * If you override this value to true, Selfie will never use triple quote literals.
   */
  open val javaDontUseTripleQuoteLiterals: Boolean
    get() = false

  internal companion object {
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/test/resources")
    internal fun initialize(): SelfieSettingsAPI {
      try {
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
      } catch (e: Throwable) {
        return SelfieSettingsSmuggleError(e)
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

internal class SelfieSettingsSmuggleError(val error: Throwable) : SelfieSettingsAPI() {}
