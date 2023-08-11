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
package com.diffplug.snapshot

interface SnapshotValue {
  val isBinary: Boolean
  fun valueBinary(): ByteArray
  fun valueString(): String

  companion object {
    fun of(binary: ByteArray): SnapshotValue = TODO()
    fun of(string: String): SnapshotValue = TODO()
  }
}

data class Snapshot(
    val value: SnapshotValue,
    private val lensData: FastMap<String, SnapshotValue>
) {
  /** A sorted immutable map of extra values. */
  val lenses: Map<String, SnapshotValue>
    get() = lensData
  fun lens(key: String, value: ByteArray) =
      Snapshot(this.value, lensData.plus(key, SnapshotValue.of(value)))
  fun lens(key: String, value: String) =
      Snapshot(this.value, lensData.plus(key, SnapshotValue.of(value)))

  companion object {
    fun of(binary: ByteArray) = Snapshot(SnapshotValue.of(binary), FastMap.empty())
    fun of(string: String) = Snapshot(SnapshotValue.of(string), FastMap.empty())
  }
}
fun parseSS(valueReader: SnapshotValueReader): FastMap<String, Snapshot> = TODO()
fun serializeSS(valueWriter: StringWriter, snapshots: FastMap<String, Snapshot>): Unit = TODO()

/** Provides the ability to parse a snapshot file incrementally. */
class SnapshotValueReader(val lineReader: LineReader) {
  /** The key of the next value, does not increment anything about the reader's state. */
  fun peekKey(): String? = TODO()
  /** Reads the next value. */
  fun nextValue(): SnapshotValue = TODO()
  /** Same as nextValue, but faster. */
  fun skipValue(): Unit = TODO()

  companion object {
    fun of(content: String) = SnapshotValueReader(LineReader.forString(content))
    fun of(content: ByteArray) = SnapshotValueReader(LineReader.forBinary(content))
  }
}

expect class LineReader {
  fun getLineNumber(): Int
  fun readLine(): String

  companion object {
    fun forString(content: String): LineReader
    fun forBinary(content: ByteArray): LineReader
  }
}

interface StringWriter {
  fun write(string: String)
}
