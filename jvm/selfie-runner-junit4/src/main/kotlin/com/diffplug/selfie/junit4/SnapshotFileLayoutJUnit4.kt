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

import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.TypedPath
import java.util.concurrent.atomic.AtomicReference

class SnapshotFileLayoutJUnit4(val className: String) {
  val smuggledError = AtomicReference<Throwable>()
  private val extension: String = ".ss"

  fun snapshotPathForClass(className: String): TypedPath {
    val lastDot = className.lastIndexOf('.')
    val classFolder: TypedPath
    val filename: String
    if (lastDot == -1) {
      classFolder = rootFolder
      filename = className + extension
    } else {
      classFolder = rootFolder.resolveFolder(className.substring(0, lastDot).replace('.', '/'))
      filename = className.substring(lastDot + 1) + extension
    }
    val parentFolder = snapshotFolderName?.let { classFolder.resolveFolder(it) } ?: classFolder
    return parentFolder.resolveFile(filename)
  }

  fun incrementContainers() {
    TODO("Coroutine support not implemented for JUnit4")
  }

  fun startTest(testName: String, isContainer: Boolean) {
    checkForSmuggledError()
    // Basic test tracking without coroutine support
  }

  fun finishedTestWithSuccess(testName: String, isContainer: Boolean, wasSuccessful: Boolean) {
    checkForSmuggledError()
    // Basic test completion tracking without coroutine support
  }

  private fun checkForSmuggledError() {
    smuggledError.get()?.let { throw it }
  }

  companion object {
    private val rootFolder = TypedPath.ofFolder(System.getProperty("user.dir"))
    private val snapshotFolderName: String? = null
  }
}
