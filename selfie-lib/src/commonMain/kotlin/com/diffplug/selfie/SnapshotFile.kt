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
package com.diffplug.selfie

class ParseException private constructor(val line: Int, message: String?, cause: Throwable?) :
    IllegalArgumentException(message, cause) {
  constructor(
      lineReader: LineReader,
      message: String
  ) : this(lineReader.getLineNumber(), message, null)

  constructor(
      lineReader: LineReader,
      cause: Exception
  ) : this(lineReader.getLineNumber(), null, cause)
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

data class Snapshot(
    val value: SnapshotValue,
    private val lensData: ArrayMap<String, SnapshotValue>
) {
  /** A sorted immutable map of extra values. */
  val lenses: Map<String, SnapshotValue>
    get() = lensData
  fun lens(key: String, value: ByteArray) = lens(key, SnapshotValue.of(value))
  fun lens(key: String, value: String) = lens(key, SnapshotValue.of(value))
  fun lens(key: String, value: SnapshotValue) = Snapshot(this.value, lensData.plus(key, value))

  companion object {
    fun of(binary: ByteArray) = Snapshot(SnapshotValue.of(binary), ArrayMap.empty())
    fun of(string: String) = Snapshot(SnapshotValue.of(string), ArrayMap.empty())
  }
}

interface Snapshotter<T> {
  fun snapshot(value: T): Snapshot
}
private fun String.efficientReplace(find: String, replaceWith: String): String {
  val idx = this.indexOf(find)
  return if (idx == -1) this else this.replace(find, replaceWith)
}

class SnapshotFile {
  // this will probably become `<String, JsonObject>` we'll cross that bridge when we get to it
  var metadata: Map.Entry<String, String>? = null
  var snapshots = ArrayMap.empty<String, Snapshot>()
  fun serialize(valueWriter: StringWriter) {
    metadata?.let {
      writeKey(valueWriter, "📷 ${it.key}", null)
      writeValue(valueWriter, SnapshotValue.of(it.value))
    }
    snapshots.entries.forEach { entry ->
      writeKey(valueWriter, entry.key, null)
      writeValue(valueWriter, entry.value.value)
      for (lens in entry.value.lenses.entries) {
        writeKey(valueWriter, entry.key, lens.key)
        writeValue(valueWriter, lens.value)
      }
    }
    writeKey(valueWriter, "", "end of file")
  }
  private fun writeKey(valueWriter: StringWriter, key: String, lens: String?) {
    valueWriter.write("╔═ ")
    valueWriter.write(SnapshotValueReader.nameEsc.escape(key))
    if (lens != null) {
      valueWriter.write("[")
      valueWriter.write(SnapshotValueReader.nameEsc.escape(lens))
      valueWriter.write("]")
    }
    valueWriter.write(" ═╗\n")
  }
  private fun writeValue(valueWriter: StringWriter, value: SnapshotValue) {
    if (value.isBinary) {
      TODO("BASE64")
    } else {
      val escaped =
          SnapshotValueReader.bodyEsc
              .escape(value.valueString())
              .efficientReplace("\n╔", "\n\uD801\uDF41")
      valueWriter.write(escaped)
      valueWriter.write("\n")
    }
  }

  private var isDirty: Boolean = false
  fun set(key: String, snapshot: Snapshot) {
    // TODO: track whenever a snapshot is set, so that we can:
    //  - warn about duplicate snapshots when they are equal
    //  - give good errors when they are not
    val newSnapshots = snapshots.plusOrReplace(key, snapshot)
    if (newSnapshots !== snapshots) {
      snapshots = newSnapshots
      isDirty = true
    }
  }

  companion object {
    private const val HEADER_PREFIX = """📷 """
    internal const val END_OF_FILE = "[end of file]"
    fun parse(valueReader: SnapshotValueReader): SnapshotFile {
      try {
        val result = SnapshotFile()
        val reader = SnapshotReader(valueReader)
        // only if the first value starts with 📷
        if (reader.peekKey()?.startsWith(HEADER_PREFIX) == true) {
          val metadataName = reader.peekKey()!!.substring(HEADER_PREFIX.length)
          val metadataValue = reader.valueReader.nextValue().valueString()
          result.metadata = entry(metadataName, metadataValue)
        }
        while (reader.peekKey() != null) {
          result.snapshots = result.snapshots.plus(reader.peekKey()!!, reader.nextSnapshot())
        }
        return result
      } catch (e: IllegalArgumentException) {
        throw if (e is ParseException) e else ParseException(valueReader.lineReader, e)
      }
    }
  }
}

class SnapshotReader(val valueReader: SnapshotValueReader) {
  fun peekKey(): String? {
    val next = valueReader.peekKey() ?: return null
    if (next == SnapshotFile.END_OF_FILE) {
      return null
    }
    require(next.indexOf('[') == -1) {
      "Missing root snapshot, square brackets not allowed: '$next'"
    }
    return next
  }
  fun nextSnapshot(): Snapshot {
    val rootName = peekKey()
    var snapshot = Snapshot(valueReader.nextValue(), ArrayMap.empty())
    while (true) {
      val nextKey = valueReader.peekKey() ?: return snapshot
      val lensIdx = nextKey.indexOf('[')
      if (lensIdx == -1 || (lensIdx == 0 && nextKey == SnapshotFile.END_OF_FILE)) {
        return snapshot
      }
      val lensRoot = nextKey.substring(0, lensIdx)
      require(lensRoot == rootName) {
        "Expected '$nextKey' to come after '$lensRoot', not '$rootName'"
      }
      val lensEndIdx = nextKey.indexOf(']', lensIdx + 1)
      require(lensEndIdx != -1) { "Missing ] in $nextKey" }
      val lensName = nextKey.substring(lensIdx + 1, lensEndIdx)
      snapshot = snapshot.lens(lensName, valueReader.nextValue().valueString())
    }
  }
  fun skipSnapshot() {
    val rootName = peekKey()!!
    valueReader.skipValue()
    while (peekKey()?.startsWith("$rootName[") == true) {
      valueReader.skipValue()
    }
  }
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
        buffer.append(KEY_FIRST_CHAR)
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
    while (nextLine != null && nextLine.indexOf(KEY_FIRST_CHAR) != 0) {
      resetLine()

      consumer(nextLine)

      // read next
      nextLine = nextLine()
    }
  }
  private fun nextKey(): String? {
    val line = nextLine() ?: return null
    val startIndex = line.indexOf(KEY_START)
    val endIndex = line.indexOf(KEY_END)
    if (startIndex == -1) {
      throw ParseException(lineReader, "Expected to start with '$KEY_START'")
    }
    if (endIndex == -1) {
      throw ParseException(lineReader, "Expected to contain '$KEY_END'")
    }
    // valid key
    val key = line.substring(startIndex + KEY_START.length, endIndex)
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

    private const val KEY_FIRST_CHAR = '╔'
    private const val KEY_START = "╔═ "
    private const val KEY_END = " ═╗"

    /**
     * https://github.com/diffplug/selfie/blob/main/selfie-lib/src/commonTest/resources/com/diffplug/selfie/scenarios_and_lenses.ss
     */
    internal val nameEsc = PerCharacterEscaper.specifiedEscape("\\\\[(])\nn\tt╔┌╗┐═─")

    /** https://github.com/diffplug/selfie/issues/2 */
    internal val bodyEsc = PerCharacterEscaper.selfEscape("\uD801\uDF43\uD801\uDF41")
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
fun interface StringWriter {
  fun write(string: String)
}
