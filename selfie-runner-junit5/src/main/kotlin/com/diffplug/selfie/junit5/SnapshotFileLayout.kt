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

import java.nio.file.Path

class SnapshotFileLayout(
    val rootFolder: Path,
    val snapshotFolderName: String?,
    internal val unixNewlines: Boolean
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
    internal fun initialize(settings: SelfieSettingsAPI): SnapshotFileLayout {
      val rootFolder = settings.rootFolder
      return SnapshotFileLayout(
          settings.rootFolder,
          settings.snapshotFolderName,
          inferDefaultLineEndingIsUnix(rootFolder))
    }

    /**
     * It's pretty easy to preserve the line endings of existing snapshot files, but it's a bit
     * harder to create a fresh snapshot file with the correct line endings.
     */
    private fun inferDefaultLineEndingIsUnix(rootFolder: Path): Boolean {
      return rootFolder
          .toFile()
          .walkTopDown()
          .filter { it.isFile }
          .mapNotNull {
            try {
              val txt = it.readText()
              // look for a file that has a newline somewhere in it
              if (txt.indexOf('\n') != -1) txt else null
            } catch (e: Exception) {
              // might be a binary file that throws an encoding exception
              null
            }
          }
          .firstOrNull()
          ?.let { it.indexOf('\r') == -1 } ?: true // if we didn't find any files, assume unix
    }
  }
}
