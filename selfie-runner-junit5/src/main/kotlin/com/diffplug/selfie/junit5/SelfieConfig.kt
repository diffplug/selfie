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

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

internal class SnapshotFileLayout(
    val rootFolder: Path,
    val snapshotFolderName: String?,
    val unixNewlines: Boolean
) {
  val extension: String = ".ss"
  fun snapshotPathForClass(className: String): Path {
    val lastDot = className.lastIndexOf('.')
    val classFolder: Path
    val filename: String
    if (lastDot == -1) {
      classFolder = rootFolder
      filename = className + extension
    } else {
      classFolder = rootFolder.resolve(className.substring(0, lastDot).replace('.', '/'))
      filename = className.substring(lastDot + 1) + extension
    }
    val parentFolder = snapshotFolderName?.let { classFolder.resolve(it) } ?: classFolder
    return parentFolder.resolve(filename)
  }
  fun subpathToClassname(subpath: String): String {
    check(subpath.indexOf('\\') == -1)
    val classnameWithSlashes =
        if (snapshotFolderName == null) {
          subpath.substring(0, subpath.length - extension.length)
        } else {
          val lastSlash = subpath.lastIndexOf('/')
          val secondToLastSlash = subpath.lastIndexOf('/', lastSlash - 1)
          check(secondToLastSlash != -1) { "Expected at least two slashes in $subpath" }
          check(lastSlash - secondToLastSlash - 1 == snapshotFolderName.length) {
            "Expected '$subpath' to be in a folder named '$snapshotFolderName'"
          }
          val simpleName = subpath.substring(lastSlash + 1, subpath.length - extension.length)
          if (secondToLastSlash == -1) simpleName
          else subpath.substring(0, secondToLastSlash + 1) + simpleName
        }
    return classnameWithSlashes.replace('/', '.')
  }

  companion object {
    private const val DEFAULT_SNAPSHOT_DIR = "__snapshots__"
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/test/resources")
    fun initialize(className: String): SnapshotFileLayout {
      val selfieDotProp = SnapshotFileLayout.javaClass.getResource("/selfie.properties")
      val properties = java.util.Properties()
      selfieDotProp?.openStream()?.use { properties.load(selfieDotProp.openStream()) }
      val snapshotFolderName = snapshotFolderName(properties.getProperty("snapshot-dir"))
      val snapshotRootFolder = rootFolder(properties.getProperty("output-dir"))
      // it's pretty easy to preserve the line endings of existing snapshot files, but it's
      // a bit harder to create a fresh snapshot file with the correct line endings.
      val unixNewlines: Boolean =
          TODO("find the first file in the snapshot folder and check if it has unix newlines")
      return SnapshotFileLayout(snapshotRootFolder, snapshotFolderName, unixNewlines)
    }
    private fun snapshotFolderName(snapshotDir: String?): String? {
      if (snapshotDir == null) {
        return DEFAULT_SNAPSHOT_DIR
      } else {
        assert(snapshotDir.indexOf('/') == -1 && snapshotDir.indexOf('\\') == -1) {
          "snapshot-dir must not contain slashes, was '$snapshotDir'"
        }
        assert(snapshotDir.trim() == snapshotDir) {
          "snapshot-dir must not have leading or trailing whitespace, was '$snapshotDir'"
        }
        return snapshotDir
      }
    }
    private fun rootFolder(rootDir: String?): Path {
      val userDir = Paths.get(System.getProperty("user.dir"))
      if (rootDir != null) {
        return userDir.resolve(rootDir)
      }
      for (standardDir in STANDARD_DIRS) {
        val candidate = userDir.resolve(standardDir)
        if (Files.isDirectory(candidate)) {
          return candidate
        }
      }
      throw AssertionError(
          "Could not find a standard test directory, 'user.dir' is equal to $userDir")
    }
  }
}
