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

import com.diffplug.selfie.guts.CallLocation
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.TypedPath

class SnapshotFileLayoutKotest(settings: SelfieSettingsAPI, override val fs: FS) :
    SnapshotFileLayout {
  internal var smuggledError: Throwable? =
      if (settings is SelfieSettingsSmuggleError) settings.error else null
  override val rootFolder = TypedPath.ofFolder(settings.rootFolder.toString())
  private val otherSourceRoots = settings.otherSourceRoots
  override val allowMultipleEquivalentWritesToOneLocation =
      settings.allowMultipleEquivalentWritesToOneLocation
  val snapshotFolderName = settings.snapshotFolderName
  internal val unixNewlines = inferDefaultLineEndingIsUnix(rootFolder, fs)
  val extension: String = ".ss"
  private val cache = CoroutineAwareCache<Pair<CallLocation, TypedPath>>()
  override fun sourcePathForCall(call: CallLocation): TypedPath {
    smuggledError?.let { throw it }
    val nonNull =
        sourcePathForCallMaybe(call)
            ?: throw fs.assertFailed(
                "Couldn't find source file for $call, looked in $rootFolder and $otherSourceRoots, maybe there are other source roots?")
    return nonNull
  }
  override fun sourcePathForCallMaybe(call: CallLocation): TypedPath? {
    val cached = cache.get()
    if (cached?.first?.samePathAs(call) == true) {
      return cached.second
    }
    val path = computePathForCall(call)
    return if (path == null) null
    else {
      cache.set(call to path)
      path
    }
  }
  override fun checkForSmuggledError() {
    smuggledError?.let { throw it }
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

expect class CoroutineAwareCache<T>() {
  fun get(): T?
  fun set(value: T)
}
