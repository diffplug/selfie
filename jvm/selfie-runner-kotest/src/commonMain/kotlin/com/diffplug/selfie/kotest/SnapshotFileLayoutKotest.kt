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

import com.diffplug.selfie.guts.AtomicRef
import com.diffplug.selfie.guts.CallLocation
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.SourcePathCache
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.atomic

class SnapshotFileLayoutKotest(settings: SelfieSettingsAPI, override val fs: FS) :
    SnapshotFileLayout {
  private var smuggledError: AtomicRef<Throwable?> =
      atomic(if (settings is SelfieSettingsSmuggleError) settings.error else null)
  override val rootFolder = TypedPath.ofFolder(settings.rootFolder.toString())
  private val otherSourceRoots = settings.otherSourceRoots
  override val allowMultipleEquivalentWritesToOneLocation =
      settings.allowMultipleEquivalentWritesToOneLocation
  private val snapshotFolderName = settings.snapshotFolderName
  internal val unixNewlines = inferDefaultLineEndingIsUnix(rootFolder, fs)
  private val extension: String = ".ss"
  private val cache = SourcePathCache(this::computePathForCall, 64)
  override fun sourcePathForCall(call: CallLocation): TypedPath {
    checkForSmuggledError()
    val nonNull =
        sourcePathForCallMaybe(call)
            ?: throw fs.assertFailed(
                "Couldn't find source file for $call, looked in $rootFolder and $otherSourceRoots, maybe there are other source roots?")
    return nonNull
  }
  override fun sourcePathForCallMaybe(call: CallLocation): TypedPath? = cache.get(call)
  override fun checkForSmuggledError() {
    smuggledError.get()?.let { throw it }
  }
  private fun computePathForCall(call: CallLocation): TypedPath? =
      sequence {
            yield(rootFolder)
            yieldAll(otherSourceRoots.map { TypedPath.ofFolder(it.toString()) })
          }
          .firstNotNullOfOrNull { computePathForCall(it, call) }
  private fun computePathForCall(folder: TypedPath, call: CallLocation): TypedPath? {
    if (call.fileName != null) {
      return fs.fileWalk(folder) { walk -> walk.filter { it.name == call.fileName }.firstOrNull() }
    }
    val fileWithoutExtension = call.sourceFilenameWithoutExtension()
    val likelyExtensions = listOf("kt", "java", "scala", "groovy", "clj", "cljc", "ts", "js")
    val possibleNames = likelyExtensions.map { "$fileWithoutExtension.$it" }.toSet()
    return fs.fileWalk(folder) { walk -> walk.filter { it.name in possibleNames }.firstOrNull() }
  }
  fun snapshotPathForClassOrFilename(classNameOrFilename: String): TypedPath {
    if (!classNameOrFilename.endsWith(".kt")) {
      val lastDot = classNameOrFilename.lastIndexOf('.')
      val classFolder: TypedPath
      val ssFilename: String
      if (lastDot == -1) {
        classFolder = rootFolder
        ssFilename = classNameOrFilename + extension
      } else {
        classFolder =
            rootFolder.resolveFolder(classNameOrFilename.substring(0, lastDot).replace('.', '/'))
        ssFilename = classNameOrFilename.substring(lastDot + 1) + extension
      }
      val ssFolder = snapshotFolderName?.let { classFolder.resolveFolder(it) } ?: classFolder
      return ssFolder.resolveFile(ssFilename)
    } else {
      val lastDot = classNameOrFilename.lastIndexOf(".")
      val snapshotFileName = classNameOrFilename.substring(0, lastDot)
      val filename = classNameOrFilename.substring(0, lastDot) + extension
      val testSource =
          FSOkio.fileWalk(rootFolder) { seq ->
            val allPaths = seq.filter { it.name == classNameOrFilename }.toList()
            if (allPaths.size > 1) {
              throw AssertionError(
                  "Cannot store snapshot because snapshot path is ambiguous, multiple files named $classNameOrFilename were found:\n  - ${allPaths.joinToString("\n  - ")}")
            } else if (allPaths.isEmpty()) {
              throw AssertionError(
                  "Cannot store snapshot because no file named $classNameOrFilename was found")
            } else {
              TypedPath.ofFile(allPaths.single().absolutePath)
            }
          }
      val folder = testSource.parentFolder()
      val ssFolder = snapshotFolderName?.let { folder.resolveFolder(it) } ?: folder
      return ssFolder.resolveFile(filename)
    }
  }

  companion object {
    /**
     * It's pretty easy to preserve the line endings of existing snapshot files, but it's a bit
     * harder to create a fresh snapshot file with the correct line endings.
     */
    private fun inferDefaultLineEndingIsUnix(rootFolder: TypedPath, fs: FS): Boolean {
      return fs.fileWalk(rootFolder) { walk ->
        walk
            .mapNotNull {
              try {
                val txt = fs.fileRead(it)
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
}
