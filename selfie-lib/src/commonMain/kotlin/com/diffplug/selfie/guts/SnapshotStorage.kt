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

import com.diffplug.selfie.ExpectedActual
import com.diffplug.selfie.Snapshot

expect interface Path : Comparable<Path>

interface FS {
  /** Returns the name of the given path. */
  fun name(path: Path): String
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  fun <T> fileWalk(path: Path, walk: (Sequence<Path>) -> T): T
  fun fileRead(path: Path): String
  fun fileWrite(path: Path, content: String)
  /** Creates an assertion failed exception to throw. */
  fun assertFailed(message: String, expected: Any? = null, actual: Any? = null): Error
}

/** NOT FOR ENDUSERS. Implemented by Selfie to integrate with various test frameworks. */
interface SnapshotStorage {
  val fs: FS
  /** Determines if the system is in write mode or read mode. */
  val isWrite: Boolean
  /** Indicates that the following value should be written into test sourcecode. */
  fun writeInline(literalValue: LiteralValue<*>)
  /** Performs a comparison between disk and actual, writing the actual to disk if necessary. */
  fun readWriteDisk(actual: Snapshot, sub: String): ExpectedActual
  /**
   * Marks that the following sub snapshots should be kept, null means to keep all snapshots for the
   * currently executing class.
   */
  fun keep(subOrKeepAll: String?)
}

expect fun initStorage(): SnapshotStorage

interface SnapshotFileLayout {
  val rootFolder: Path
  val fs: FS
  val allowMultipleEquivalentWritesToOneLocation: Boolean
  fun sourcecodeForCall(call: CallLocation): Path?
}
