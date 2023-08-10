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

interface Snapshotter<T> {
  fun snapshot(value: T): Snapshot
}

interface SnapshotValueFile {
  fun get(prefix: String): Snapshot? = TODO()

  fun putString(prefix: String, content: String): Unit = TODO()

  fun putBinary(prefix: String, content: ByteArray): Unit = TODO()
}

interface SnapshotValueReader {
  fun nextKey(): String?

  fun nextValue(): SnapshotValue
}

interface ExpectSnapshot {
  fun toMatchSnapshotBinary(content: ByteArray)

  fun toMatchSnapshot(content: Any)

  fun <T> toMatchSnapshot(content: T, snapshotter: Snapshotter<T>)

  fun scenario(name: String): ExpectSnapshot
}

interface ExpectInplace {
  fun toMatch(content: Int, actual: Int)

  fun toMatch(content: Long, actual: Long)

  fun toMatch(content: Boolean, actual: Boolean)

  fun toMatch(content: Any, actual: String)
}

interface Expect : ExpectSnapshot, ExpectInplace
