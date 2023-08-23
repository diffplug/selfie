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

class ParseException(val line: Int, message: String) : IllegalArgumentException(message) {
  constructor(lineReader: LineReader, message: String) : this(lineReader.getLineNumber(), message)
  override val message: String
    get() = "L${line}:${super.message}"
}

sealed interface SnapshotValue {
  val isBinary: Boolean
    get() = this is SnapshotValueBinary
  fun valueBinary(): ByteArray
  fun valueString(): String

  companion object {
    fun of(binary: ByteArray): SnapshotValue = SnapshotValueBinary(binary)
    fun of(string: String): SnapshotValue = SnapshotValueString(string)
  }
}

internal data class SnapshotValueBinary(val value: ByteArray) : SnapshotValue {
  override fun valueBinary(): ByteArray = value
  override fun valueString() = throw UnsupportedOperationException("This is a binary value.")
  override fun hashCode(): Int = value.contentHashCode()
  override fun equals(other: Any?): Boolean =
      if (this === other) true
      else (other is SnapshotValueBinary && value.contentEquals(other.value))
}

internal data class SnapshotValueString(val value: String) : SnapshotValue {
  override fun valueBinary() = throw UnsupportedOperationException("This is a string value.")
  override fun valueString(): String = value
}

internal data class SnapshotValueEmptyString(val value: String) : SnapshotValue {
  override fun valueBinary() = throw UnsupportedOperationException("This is an empty string value.")
  override fun valueString() = value
}

data class Snapshot(
    val value: SnapshotValue,
    private val lensData: ArrayMap<String, SnapshotValue>
) {
  /** A sorted immutable map of extra values. */
  val lenses: Map<String, SnapshotValue>
    get() = lensData
  fun lens(key: String, value: ByteArray) =
      Snapshot(this.value, lensData.plus(key, SnapshotValue.of(value)))
  fun lens(key: String, value: String) =
      Snapshot(this.value, lensData.plus(key, SnapshotValue.of(value)))

  companion object {
    fun of(binary: ByteArray) = Snapshot(SnapshotValue.of(binary), ArrayMap.empty())
    fun of(string: String) = Snapshot(SnapshotValue.of(string), ArrayMap.empty())
  }
}

interface Snapshotter<T> {
  fun snapshot(value: T): Snapshot
}
fun parseSS(valueReader: SnapshotValueReader): ArrayMap<String, Snapshot> = TODO()
fun serializeSS(valueWriter: StringWriter, snapshots: ArrayMap<String, Snapshot>): Unit = TODO()

class SnapshotReader(val valueReader: SnapshotValueReader) {
  fun peekKey(): String? = TODO()
  fun nextSnapshot(): Snapshot = TODO()
  fun skipSnapshot(): Unit = TODO()
}

/** Provides the ability to parse a snapshot file incrementally. */
class SnapshotValueReader(val lineReader: LineReader) {
  var line: String? = null

  /** The key of the next value, does not increment anything about the reader's state. */
  fun peekKey(): String? {
    return nextKey()
  }

  /** Reads the next value. */
  fun nextValue(): SnapshotValue {
    // validate key
    nextKey()
    resetLine()

    // read value
    val buffer = StringBuilder()
    scanValue { line ->
      if (line.length >= 2 && line[0] == '\uD801' && line[1] == '\uDF41') { // "\uD801\uDF41" = "𐝁"
        buffer.append('╔')
        buffer.append(line, 2, line.length)
      } else {
        buffer.append(line)
      }
      buffer.append('\n')
    }
    return SnapshotValue.of(
        if (buffer.isEmpty()) ""
        else {
          buffer.setLength(buffer.length - 1)
          bodyEsc.unescape(buffer.toString())
        })
  }

  /** Same as nextValue, but faster. */
  fun skipValue() {
    // Ignore key
    nextKey()
    resetLine()

    scanValue {
      // ignore it
    }
  }
  private inline fun scanValue(consumer: (String) -> Unit) {
    // read next
    var nextLine = nextLine()
    while (nextLine != null && nextLine.indexOf(headerFirstChar) != 0) {
      resetLine()

      consumer(nextLine)

      // read next
      nextLine = nextLine()
    }
  }
  private fun nextKey(): String? {
    val line = nextLine() ?: return null
    val startIndex = line.indexOf(headerStart)
    val endIndex = line.indexOf(headerEnd)
    if (startIndex == -1) {
      throw ParseException(lineReader, "Expected to start with '$headerStart'")
    }
    if (endIndex == -1) {
      throw ParseException(lineReader, "Expected to contain '$headerEnd'")
    }
    // valid key
    val key = line.substring(startIndex + headerStart.length, endIndex)
    return if (key.startsWith(" ")) {
      throw ParseException(lineReader, "Leading spaces are disallowed: '$key'")
    } else if (key.endsWith(" ")) {
      throw ParseException(lineReader, "Trailing spaces are disallowed: '$key'")
    } else {
      nameEsc.unescape(key)
    }
  }
  private fun nextLine(): String? {
    if (line == null) {
      line = lineReader.readLine()
    }
    return line
  }
  private fun resetLine() {
    line = null
  }

  companion object {
    fun of(content: String) = SnapshotValueReader(LineReader.forString(content))
    fun of(content: ByteArray) = SnapshotValueReader(LineReader.forBinary(content))
    private val headerFirstChar = '╔'
    private val headerStart = "╔═ "
    private val headerEnd = " ═╗"

    /**
     * https://github.com/diffplug/spotless-snapshot/blob/f63192a84390901a3d3543066d095ea23bf81d21/snapshot-lib/src/commonTest/resources/com/diffplug/snapshot/scenarios_and_lenses.ss#L11-L29
     */
    private val nameEsc = PerCharacterEscaper.specifiedEscape("\\\\/∕[(])\nn\tt╔┌╗┐═─")

    /** https://github.com/diffplug/spotless-snapshot/issues/2 */
    private val bodyEsc = PerCharacterEscaper.selfEscape("\uD801\uDF43\uD801\uDF41")
  }
}

expect class LineReader {
  fun getLineNumber(): Int
  fun readLine(): String?

  companion object {
    fun forString(content: String): LineReader
    fun forBinary(content: ByteArray): LineReader
  }
}

interface StringWriter {
  fun write(string: String)
}
