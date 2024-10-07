/*
 * Copyright (C) 2023-2024 DiffPlug
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

import com.diffplug.selfie.guts.atomic
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.jvm.JvmStatic

class ParseException
private constructor(val line: Int, private val innerMessage: String?, cause: Throwable?) :
    IllegalArgumentException(innerMessage, cause) {
  constructor(
      lineReader: LineReader,
      message: String
  ) : this(lineReader.getLineNumber(), message, null)

  constructor(
      lineReader: LineReader,
      cause: Exception
  ) : this(lineReader.getLineNumber(), null, cause)
  override val message: String
    get() = "L${line}:${innerMessage ?: super.cause!!.message}"
}

sealed interface SnapshotValue {
  val isBinary: Boolean
    get() = this is SnapshotValueBinary
  fun valueBinary(): ByteArray
  fun valueString(): String

  companion object {
    fun of(binary: ByteArray): SnapshotValue = SnapshotValueBinary(binary)
    fun of(string: String): SnapshotValue = SnapshotValueString(unixNewlines(string))
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
  override fun toString(): String = value
}

@ConsistentCopyVisibility
data class Snapshot
private constructor(
    val subject: SnapshotValue,
    private val facetData: ArrayMap<String, SnapshotValue>
) {
  /** A sorted immutable map of extra values. */
  val facets: Map<String, SnapshotValue>
    get() = facetData
  fun plusFacet(key: String, value: ByteArray) = plusFacet(key, SnapshotValue.of(value))
  fun plusFacet(key: String, value: String) = plusFacet(key, SnapshotValue.of(value))
  fun plusFacet(key: String, value: SnapshotValue): Snapshot =
      if (key.isEmpty())
          throw IllegalArgumentException("The empty string is reserved for the subject.")
      else Snapshot(subject, facetData.plus(unixNewlines(key), value))
  /** Adds or replaces the given facet or subject (subject is key=""). */
  fun plusOrReplace(key: String, value: SnapshotValue): Snapshot =
      if (key.isEmpty()) Snapshot(value, facetData)
      else Snapshot(subject, facetData.plusOrNoOpOrReplace(unixNewlines(key), value))
  /** Retrieves the given facet or subject (subject is key=""). */
  fun subjectOrFacetMaybe(key: String): SnapshotValue? =
      if (key.isEmpty()) subject else facetData[key]
  fun subjectOrFacet(key: String): SnapshotValue =
      subjectOrFacetMaybe(key)
          ?: throw NoSuchElementException("'${key}' not found in ${facetData.keys}")

  /**
   * Returns all values in the snapshot, including the root, in a single map, with the root having
   * key "".
   */
  fun allEntries(): Iterable<Map.Entry<String, SnapshotValue>> = Iterable {
    sequence {
          yield(entry("", subject))
          yieldAll(facetData.entries)
        }
        .iterator()
  }
  override fun toString(): String = "[${subject} ${facetData}]"

  companion object {
    @JvmStatic fun of(binary: ByteArray) = of(SnapshotValue.of(binary))
    @JvmStatic fun of(string: String) = of(SnapshotValue.of(string))
    @JvmStatic fun of(subject: SnapshotValue) = Snapshot(subject, ArrayMap.empty())

    /**
     * Creates a [Snapshot] from an [Iterable]<Map.Entry<String, [SnapshotValue]>. If no root is
     * provided, it will be automatically filled by an empty string.
     */
    fun ofEntries(entries: Iterable<Map.Entry<String, SnapshotValue>>): Snapshot {
      var root: SnapshotValue? = null
      var facets = ArrayMap.empty<String, SnapshotValue>()
      for (entry in entries) {
        if (entry.key.isEmpty()) {
          require(root == null) {
            "Duplicate root snapshot.\n first: $root\nsecond: ${entry.value}"
          }
          root = entry.value
        } else {
          facets = facets.plus(entry.key, entry.value)
        }
      }
      return Snapshot(root ?: SnapshotValue.of(""), facets)
    }
  }
}
internal fun String.efficientReplace(find: String, replaceWith: String): String {
  val idx = this.indexOf(find)
  return if (idx == -1) this else this.replace(find, replaceWith)
}
private fun unixNewlines(str: String) = str.efficientReplace("\r\n", "\n")

class SnapshotFile {
  internal var unixNewlines = true
  // this will probably become `<String, JsonObject>` we'll cross that bridge when we get to it
  var metadata: Map.Entry<String, String>? = null
  var snapshots: ArrayMap<String, Snapshot>
    get() = _snapshots.get()
    set(value) {
      _snapshots.updateAndGet { value }
    }
  private val _snapshots = atomic(ArrayMap.empty<String, Snapshot>())
  fun serialize(valueWriterRaw: Appendable) {
    val valueWriter = if (unixNewlines) valueWriterRaw else ConvertToWindowsNewlines(valueWriterRaw)
    metadata?.let { writeEntry(valueWriter, "📷 ${it.key}", null, SnapshotValue.of(it.value)) }
    _snapshots.get().entries.forEach { entry ->
      writeEntry(valueWriter, entry.key, null, entry.value.subject)
      for (facet in entry.value.facets.entries) {
        writeEntry(valueWriter, entry.key, facet.key, facet.value)
      }
    }
    writeEntry(valueWriter, "", "end of file", SnapshotValue.of(""))
  }
  val wasSetAtTestTime: Boolean
    get() = _wasSetAtTestTime.get()
  private val _wasSetAtTestTime = atomic(false)
  fun setAtTestTime(key: String, snapshot: Snapshot) {
    val oldSnapshots = _snapshots.get()
    val newSnapshots = _snapshots.updateAndGet { it.plusOrNoOpOrReplace(key, snapshot) }
    _wasSetAtTestTime.updateAndGet { wasSetBefore -> wasSetBefore || newSnapshots !== oldSnapshots }
  }
  fun removeAllIndices(indices: List<Int>) {
    if (indices.isEmpty()) {
      return
    }
    _wasSetAtTestTime.updateAndGet { true }
    snapshots = snapshots.minusSortedIndices(indices)
  }

  companion object {
    private const val HEADER_PREFIX = """📷 """
    internal const val END_OF_FILE = "[end of file]"
    fun parse(valueReader: SnapshotValueReader): SnapshotFile {
      try {
        val result = SnapshotFile()
        result.unixNewlines = valueReader.unixNewlines
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
    fun createEmptyWithUnixNewlines(unixNewlines: Boolean): SnapshotFile {
      val result = SnapshotFile()
      result.unixNewlines = unixNewlines
      return result
    }

    @OptIn(ExperimentalEncodingApi::class)
    internal fun writeEntry(
        valueWriter: Appendable,
        key: String,
        facet: String?,
        value: SnapshotValue
    ) {
      valueWriter.append("╔═ ")
      valueWriter.append(SnapshotValueReader.nameEsc.escape(key))
      if (facet != null) {
        valueWriter.append("[")
        valueWriter.append(SnapshotValueReader.nameEsc.escape(facet))
        valueWriter.append("]")
      }
      valueWriter.append(" ═╗")
      if (value.isBinary) {
        valueWriter.append(" base64 length ")
        valueWriter.append(value.valueBinary().size.toString())
        valueWriter.append(" bytes")
      }
      valueWriter.append("\n")

      if (key.isEmpty() && facet == "end of file") {
        return
      }

      if (value.isBinary) {
        val escaped = Base64.Mime.encode(value.valueBinary())
        valueWriter.append(escaped.efficientReplace("\r", ""))
      } else {
        val escaped =
            SnapshotValueReader.bodyEsc
                .escape(value.valueString())
                .efficientReplace("\n╔", "\n\uD801\uDF41")
        valueWriter.append(escaped)
      }
      valueWriter.append("\n")
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
    var snapshot = Snapshot.of(valueReader.nextValue())
    while (true) {
      val nextKey = valueReader.peekKey() ?: return snapshot
      val facetIdx = nextKey.indexOf('[')
      if (facetIdx == -1 || (facetIdx == 0 && nextKey == SnapshotFile.END_OF_FILE)) {
        return snapshot
      }
      val facetRoot = nextKey.substring(0, facetIdx)
      require(facetRoot == rootName) {
        "Expected '$nextKey' to come after '$facetRoot', not '$rootName'"
      }
      val facetEndIdx = nextKey.indexOf(']', facetIdx + 1)
      require(facetEndIdx != -1) { "Missing ] in $nextKey" }
      val facetName = nextKey.substring(facetIdx + 1, facetEndIdx)
      snapshot = snapshot.plusFacet(facetName, valueReader.nextValue())
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
  val unixNewlines = lineReader.unixNewlines()

  /** The key of the next value, does not increment anything about the reader's state. */
  fun peekKey(): String? {
    return nextKey()
  }

  /** Reads the next value. */
  @OptIn(ExperimentalEncodingApi::class)
  fun nextValue(): SnapshotValue {
    // validate key
    nextKey()
    val isBase64 = nextLine()!!.contains(FLAG_BASE64)
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
    val rawString =
        if (buffer.isEmpty()) ""
        else {
          buffer.setLength(buffer.length - 1)
          buffer.toString()
        }
    return if (isBase64) SnapshotValue.of(Base64.Mime.decode(rawString))
    else SnapshotValue.of(bodyEsc.unescape(rawString))
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
    private const val FLAG_BASE64 = " ═╗ base64"

    /**
     * https://github.com/diffplug/selfie/blob/main/jvm/selfie-lib/src/commonTest/resources/com/diffplug/selfie/scenarios_and_lenses.ss
     */
    internal val nameEsc = PerCharacterEscaper.specifiedEscape("\\\\[(])\nn\tt╔┌╗┐═─")

    /** https://github.com/diffplug/selfie/issues/2 */
    internal val bodyEsc = PerCharacterEscaper.selfEscape("\uD801\uDF43\uD801\uDF41")
  }
}

class LineReader private constructor(private val content: String) {
  private var currentLine: Int = 0
  private var currentPos: Int = 0
  fun getLineNumber(): Int = currentLine
  fun readLine(): String? {
    if (currentPos >= content.length) return null
    val start = currentPos
    val end = content.indexOf('\n', start)
    val line: String =
        if (end == -1) {
          // No more newline characters, read to the end of the content
          content.substring(start).also { currentPos = content.length }
        } else {
          content.substring(start, end).also { currentPos = end + 1 }
        }

    currentLine++
    return if (line.endsWith("\r")) line.substring(0, line.length - 1) else line
  }
  fun unixNewlines(): Boolean = !content.contains("\r\n")

  companion object {
    fun forString(content: String) = LineReader(content)
    fun forBinary(content: ByteArray) = forString(content.decodeToString())
  }
}

internal class ConvertToWindowsNewlines(val sink: Appendable) : Appendable {
  override fun append(value: Char): Appendable {
    if (value != '\n') sink.append(value)
    else {
      sink.append('\r')
      sink.append('\n')
    }
    return this
  }
  override fun append(value: CharSequence?): Appendable {
    value?.let { sink.append(it.toString().efficientReplace("\n", "\r\n")) }
    return this
  }
  override fun append(value: CharSequence?, startIndex: Int, endIndex: Int): Appendable {
    value?.let { sink.append(it.substring(startIndex, endIndex).efficientReplace("\n", "\r\n")) }
    return this
  }
}
