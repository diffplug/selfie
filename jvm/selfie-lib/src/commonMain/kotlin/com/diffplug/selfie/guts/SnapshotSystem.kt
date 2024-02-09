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
package com.diffplug.selfie.guts

import com.diffplug.selfie.Mode
import com.diffplug.selfie.Snapshot
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/** Used by [com.diffplug.selfie.SelfieSuspend]. */
class CoroutineDiskStorage(val disk: DiskStorage) : AbstractCoroutineContextElement(Key) {
  override val key = Key

  companion object Key : CoroutineContext.Key<CoroutineDiskStorage>
}

/** A unix-style path where trailing-slash means it is a folder. */
data class TypedPath(val absolutePath: String) : Comparable<TypedPath> {
  override fun compareTo(other: TypedPath): Int = absolutePath.compareTo(other.absolutePath)
  val name: String
    get() {
      val lastSlash = absolutePath.lastIndexOf('/')
      return if (lastSlash == -1) absolutePath else absolutePath.substring(lastSlash + 1)
    }
  val isFolder: Boolean
    get() = absolutePath.endsWith("/")
  private fun assertFolder() {
    check(isFolder) { "Expected $this to be a folder but it doesn't end with `/`" }
  }
  fun parentFolder(): TypedPath {
    val lastIdx = absolutePath.lastIndexOf('/')
    check(lastIdx != -1)
    return ofFolder(absolutePath.substring(0, lastIdx + 1))
  }
  fun resolveFile(child: String): TypedPath {
    assertFolder()
    check(!child.startsWith("/")) { "Expected child to not start with a slash, but got $child" }
    check(!child.endsWith("/")) { "Expected child to not end with a slash, but got $child" }
    return ofFile("$absolutePath$child")
  }
  fun resolveFolder(child: String): TypedPath {
    assertFolder()
    check(!child.startsWith("/")) { "Expected child to not start with a slash, but got $child" }
    return ofFolder("$absolutePath$child")
  }
  fun relativize(child: TypedPath): String {
    assertFolder()
    check(child.absolutePath.startsWith(absolutePath)) {
      "Expected $child to start with $absolutePath"
    }
    return child.absolutePath.substring(absolutePath.length)
  }

  companion object {
    /** A folder at the given path. */
    fun ofFolder(path: String): TypedPath {
      val unixPath = path.replace("\\", "/")
      return TypedPath(if (unixPath.endsWith("/")) unixPath else "$unixPath/")
    }
    /** A file (NOT a folder) at the given path. */
    fun ofFile(path: String): TypedPath {
      val unixPath = path.replace("\\", "/")
      check(!unixPath.endsWith("/")) { "Expected path to not end with a slash, but got $unixPath" }
      return TypedPath(unixPath)
    }
  }
}

interface FS {
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  fun <T> fileWalk(typedPath: TypedPath, walk: (Sequence<TypedPath>) -> T): T
  fun fileRead(typedPath: TypedPath): String
  fun fileWrite(typedPath: TypedPath, content: String)
  /** Creates an assertion failed exception to throw. */
  fun assertFailed(message: String, expected: Any? = null, actual: Any? = null): Throwable
}

/** NOT FOR ENDUSERS. Implemented by Selfie to integrate with various test frameworks. */
interface SnapshotSystem {
  val fs: FS
  val mode: Mode
  val layout: SnapshotFileLayout
  /** Returns true if the sourcecode for the given call has a writable annotation. */
  fun sourceFileHasWritableComment(call: CallStack): Boolean
  /** Indicates that the following value should be written into test sourcecode. */
  fun writeInline(literalValue: LiteralValue<*>, call: CallStack)
  /** Returns the DiskStorage for the test associated with this thread, else error. */
  fun diskThreadLocal(): DiskStorage
  /** Returns the DiskStorage for the test associated with this coroutine, else error. */
  suspend fun diskCoroutine(): DiskStorage
}

/** Represents the disk storage for a specific test. */
interface DiskStorage {
  /** Reads the given snapshot from disk. */
  fun readDisk(sub: String, call: CallStack): Snapshot?
  /** Writes the given snapshot to disk. */
  fun writeDisk(actual: Snapshot, sub: String, call: CallStack)
  /**
   * Marks that the following sub snapshots should be kept, null means to keep all snapshots for the
   * currently executing class.
   */
  fun keep(subOrKeepAll: String?)
}

expect fun initSnapshotSystem(): SnapshotSystem

interface SnapshotFileLayout {
  val rootFolder: TypedPath
  val fs: FS
  val allowMultipleEquivalentWritesToOneLocation: Boolean
  fun sourcePathForCall(call: CallLocation): TypedPath
  fun sourcePathForCallMaybe(call: CallLocation): TypedPath?
  fun checkForSmuggledError()
}
