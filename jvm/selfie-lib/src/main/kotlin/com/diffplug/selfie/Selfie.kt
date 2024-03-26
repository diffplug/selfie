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

import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.CommentTracker
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralBoolean
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralInt
import com.diffplug.selfie.guts.LiteralLong
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.TodoStub
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.atomic
import com.diffplug.selfie.guts.initSnapshotSystem
import com.diffplug.selfie.guts.recordCall
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.io.LineNumberReader
import java.io.ObjectOutputStream
import java.io.Reader
import java.io.StringReader
import java.nio.CharBuffer
import java.nio.charset.StandardCharsets
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.jvm.JvmStatic

/** A getter which may or may not be run. */
fun interface Cacheable<T> {
  @Throws(Throwable::class) fun get(): T
}

/** Static methods for creating snapshots. */
object Selfie {
  internal val system: SnapshotSystem = initSnapshotSystem()
  private val deferredDiskStorage =
      object : DiskStorage {
        override fun readDisk(sub: String, call: CallStack): Snapshot? =
            system.diskThreadLocal().readDisk(sub, call)
        override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) =
            system.diskThreadLocal().writeDisk(actual, sub, call)
        override fun keep(subOrKeepAll: String?) = system.diskThreadLocal().keep(subOrKeepAll)
      }

  /**
   * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
   * environment.
   */
  @JvmStatic
  fun preserveSelfiesOnDisk(vararg subsToKeep: String) {
    val disk = system.diskThreadLocal()
    if (subsToKeep.isEmpty()) {
      disk.keep(null)
    } else {
      subsToKeep.forEach { disk.keep(it) }
    }
  }

  @JvmStatic
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))

  @JvmStatic
  fun expectSelfie(actual: ByteArray) = BinarySelfie(Snapshot.of(actual), deferredDiskStorage, "")
  @JvmStatic fun expectSelfie(actual: String) = expectSelfie(Snapshot.of(actual))
  @JvmStatic fun expectSelfie(actual: Snapshot) = StringSelfie(actual, deferredDiskStorage)
  @JvmStatic fun expectSelfie(actual: Long) = LongSelfie(actual)
  @JvmStatic fun expectSelfie(actual: Int) = IntSelfie(actual)
  @JvmStatic fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)

  @JvmStatic
  fun cacheSelfie(toCache: Cacheable<String>) = cacheSelfie(Roundtrip.identity(), toCache)

  @JvmStatic
  fun <T> cacheSelfie(roundtrip: Roundtrip<T, String>, toCache: Cacheable<T>) =
      CacheSelfie(deferredDiskStorage, roundtrip, toCache)
  /**
   * Memoizes any type which is marked with `@kotlinx.serialization.Serializable` as pretty-printed
   * json.
   */
  inline fun <reified T> cacheSelfieJson(noinline toCache: () -> T) =
      cacheSelfie(RoundtripJson.of<T>(), toCache)

  @JvmStatic
  fun cacheSelfieBinary(toCache: Cacheable<ByteArray>) =
      cacheSelfieBinary(Roundtrip.identity(), toCache)

  @JvmStatic
  fun <T> cacheSelfieBinary(roundtrip: Roundtrip<T, ByteArray>, toCache: Cacheable<T>) =
      CacheSelfieBinary<T>(deferredDiskStorage, roundtrip, toCache)
}

/** A selfie which can be stored into a selfie-managed file. */
open class DiskSelfie
internal constructor(protected val actual: Snapshot, protected val disk: DiskStorage) :
    FluentFacet {
  @JvmOverloads
  open fun toMatchDisk(sub: String = ""): DiskSelfie {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(false, call, Selfie.system)) {
      disk.writeDisk(actual, sub, call)
    } else {
      assertEqual(disk.readDisk(sub, call), actual, Selfie.system)
    }
    return this
  }

  @JvmOverloads
  open fun toMatchDisk_TODO(sub: String = ""): DiskSelfie {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(true, call, Selfie.system)) {
      disk.writeDisk(actual, sub, call)
      Selfie.system.writeInline(TodoStub.toMatchDisk.createLiteral(), call)
      return this
    } else {
      throw Selfie.system.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
    }
  }
  override fun facet(facet: String): StringFacet = StringSelfie(actual, disk, listOf(facet))
  override fun facets(vararg facets: String): StringFacet =
      StringSelfie(actual, disk, facets.toList())
  override fun facetBinary(facet: String) = BinarySelfie(actual, disk, facet)
}

interface FluentFacet {
  /** Extract a single facet from a snapshot in order to do an inline snapshot. */
  fun facet(facet: String): StringFacet
  /** Extract multiple facets from a snapshot in order to do an inline snapshot. */
  fun facets(vararg facets: String): StringFacet
  fun facetBinary(facet: String): BinaryFacet
}

interface StringFacet : FluentFacet {
  fun toBe(expected: String): String
  fun toBe_TODO(unusedArg: Any?): String = toBe_TODO()
  fun toBe_TODO(): String
}

interface BinaryFacet : FluentFacet {
  fun toBeBase64(expected: String): ByteArray
  fun toBeBase64_TODO(unusedArg: Any?): ByteArray = toBeBase64_TODO()
  fun toBeBase64_TODO(): ByteArray
  fun toBeFile(subpath: String): ByteArray
  fun toBeFile_TODO(subpath: String): ByteArray
}

class BinarySelfie(actual: Snapshot, disk: DiskStorage, private val onlyFacet: String) :
    DiskSelfie(actual, disk), BinaryFacet {
  init {
    check(actual.subjectOrFacetMaybe(onlyFacet)?.isBinary == true) {
      "The facet $onlyFacet was not found in the snapshot, or it was not a binary facet."
    }
  }
  private fun actualBytes() = actual.subjectOrFacet(onlyFacet).valueBinary()
  override fun toMatchDisk(sub: String): BinarySelfie {
    super.toMatchDisk(sub)
    return this
  }
  override fun toMatchDisk_TODO(sub: String): BinarySelfie {
    super.toMatchDisk_TODO(sub)
    return this
  }

  @OptIn(ExperimentalEncodingApi::class)
  private fun actualString(): String = Base64.Mime.encode(actualBytes()).replace("\r", "")
  override fun toBeBase64_TODO(): ByteArray {
    toBeDidntMatch(null, actualString(), LiteralString)
    return actualBytes()
  }

  @OptIn(ExperimentalEncodingApi::class)
  override fun toBeBase64(expected: String): ByteArray {
    val expectedBytes = Base64.Mime.decode(expected)
    val actualBytes = actualBytes()
    return if (expectedBytes.contentEquals(actualBytes)) Selfie.system.checkSrc(actualBytes)
    else {
      toBeDidntMatch(expected, actualString(), LiteralString)
      return actualBytes()
    }
  }
  override fun toBeFile_TODO(subpath: String): ByteArray {
    return toBeFileImpl(subpath, true)
  }
  override fun toBeFile(subpath: String): ByteArray {
    return toBeFileImpl(subpath, false)
  }
  private fun resolvePath(subpath: String) = Selfie.system.layout.rootFolder.resolveFile(subpath)
  private fun toBeFileImpl(subpath: String, isTodo: Boolean): ByteArray {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(isTodo, call, Selfie.system)
    val actualBytes = actualBytes()
    if (writable) {
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toBeFile.createLiteral(), call)
      }
      Selfie.system.writeToBeFile(resolvePath(subpath), actualBytes, call)
      return actualBytes
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed("Can't call `toBeFile_TODO` in ${Mode.readonly} mode!")
      } else {
        val path = resolvePath(subpath)
        if (!Selfie.system.fs.fileExists(path)) {
          throw Selfie.system.fs.assertFailed(
              Selfie.system.mode.msgSnapshotNotFoundNoSuchFile(path))
        }
        val expected = Selfie.system.fs.fileReadBinary(path)
        if (expected.contentEquals(actualBytes)) {
          return actualBytes
        } else {
          throw Selfie.system.fs.assertFailed(
              Selfie.system.mode.msgSnapshotMismatch(), expected, actualBytes)
        }
      }
    }
  }
}

class StringSelfie(
    actual: Snapshot,
    disk: DiskStorage,
    private val onlyFacets: Collection<String>? = null
) : DiskSelfie(actual, disk), StringFacet {
  init {
    if (onlyFacets != null) {
      check(onlyFacets.all { it == "" || actual.facets.containsKey(it) }) {
        "The following facets were not found in the snapshot: ${onlyFacets.filter { actual.subjectOrFacetMaybe(it) == null }}\navailable facets are: ${actual.facets.keys}"
      }
      check(onlyFacets.isNotEmpty()) { "Must have at least one facet to display, this was empty." }
      if (onlyFacets.contains("")) {
        check(onlyFacets.indexOf("") == 0) {
          "If you're going to specify the subject facet (\"\"), you have to list it first, this was $onlyFacets"
        }
      }
    }
  }
  override fun toMatchDisk(sub: String): StringSelfie {
    super.toMatchDisk(sub)
    return this
  }
  override fun toMatchDisk_TODO(sub: String): StringSelfie {
    super.toMatchDisk_TODO(sub)
    return this
  }

  @OptIn(ExperimentalEncodingApi::class)
  private fun actualString(): String {
    if (actual.facets.isEmpty() || onlyFacets?.size == 1) {
      // single value doesn't have to worry about escaping at all
      val onlyValue = actual.subjectOrFacet(onlyFacets?.first() ?: "")
      return if (onlyValue.isBinary) {
        Base64.Mime.encode(onlyValue.valueBinary()).replace("\r", "")
      } else onlyValue.valueString()
    } else {
      return serializeOnlyFacets(
          actual,
          onlyFacets
              ?: buildList {
                add("")
                addAll(actual.facets.keys)
              })
    }
  }
  override fun toBe_TODO(): String = toBeDidntMatch(null, actualString(), LiteralString)
  override fun toBe(expected: String): String {
    val actualString = actualString()
    return if (actualString == expected) Selfie.system.checkSrc(actualString)
    else toBeDidntMatch(expected, actualString, LiteralString)
  }
}

/**
 * Returns a serialized form of only the given facets if they are available, silently omits missing
 * facets.
 */
private fun serializeOnlyFacets(snapshot: Snapshot, keys: Collection<String>): String {
  val writer = StringBuilder()
  for (key in keys) {
    if (key.isEmpty()) {
      SnapshotFile.writeEntry(writer, "", null, snapshot.subjectOrFacet(key))
    } else {
      snapshot.subjectOrFacetMaybe(key)?.let { SnapshotFile.writeEntry(writer, "", key, it) }
    }
  }
  val EMPTY_KEY_AND_FACET = "╔═  ═╗\n"
  return if (writer.startsWith(EMPTY_KEY_AND_FACET)) {
    // this codepath is triggered by the `key.isEmpty()` line above
    writer.subSequence(EMPTY_KEY_AND_FACET.length, writer.length - 1).toString()
  } else {
    writer.setLength(writer.length - 1)
    writer.toString()
  }
}

/** Implements the inline snapshot whenever a match fails. */
private fun <T : Any> toBeDidntMatch(expected: T?, actual: T, format: LiteralFormat<T>): T {
  val call = recordCall(false)
  val writable = Selfie.system.mode.canWrite(expected == null, call, Selfie.system)
  if (writable) {
    Selfie.system.writeInline(LiteralValue(expected, actual, format), call)
    return actual
  } else {
    if (expected == null) {
      throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
    } else {
      throw Selfie.system.fs.assertFailed(
          Selfie.system.mode.msgSnapshotMismatch(), expected, actual)
    }
  }
}
private fun assertEqual(expected: Snapshot?, actual: Snapshot, storage: SnapshotSystem) {
  when (expected) {
    null -> throw storage.fs.assertFailed(storage.mode.msgSnapshotNotFound())
    actual -> return
    else -> {
      val mismatchedKeys =
          sequence {
                yield("")
                yieldAll(expected.facets.keys)
                for (facet in actual.facets.keys) {
                  if (!expected.facets.containsKey(facet)) {
                    yield(facet)
                  }
                }
              }
              .filter { expected.subjectOrFacetMaybe(it) != actual.subjectOrFacetMaybe(it) }
              .toList()
              .sorted()
      throw storage.fs.assertFailed(
          storage.mode.msgSnapshotMismatch(),
          serializeOnlyFacets(expected, mismatchedKeys),
          serializeOnlyFacets(actual, mismatchedKeys))
    }
  }
}

/**
 * Checks that the sourcecode of the given inline snapshot value doesn't have control comments when
 * in readonly mode.
 */
private fun <T> SnapshotSystem.checkSrc(value: T): T {
  mode.canWrite(false, recordCall(true), this)
  return value
}

///////////////////////
// Primitive selfies //
///////////////////////
class IntSelfie(private val actual: Int) {
  @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralInt)
  fun toBe(expected: Int) =
      if (actual == expected) Selfie.system.checkSrc(actual)
      else toBeDidntMatch(expected, actual, LiteralInt)
}

class LongSelfie(private val actual: Long) {
  @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralLong)
  fun toBe(expected: Long) =
      if (actual == expected) Selfie.system.checkSrc(actual)
      else toBeDidntMatch(expected, actual, LiteralLong)
}

class BooleanSelfie(private val actual: Boolean) {
  @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralBoolean)
  fun toBe(expected: Boolean) =
      if (actual == expected) Selfie.system.checkSrc(actual)
      else toBeDidntMatch(expected, actual, LiteralBoolean)
}

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
          yield(java.util.Map.entry("", subject))
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
          result.metadata = java.util.Map.entry(metadataName, metadataValue)
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

class LineReader(reader: Reader) {
  private val reader = LineTerminatorAware(LineTerminatorReader(reader))

  companion object {
    fun forString(content: String) = LineReader(StringReader(content))
    fun forBinary(content: ByteArray) =
        LineReader(InputStreamReader(content.inputStream(), StandardCharsets.UTF_8))
  }
  fun getLineNumber(): Int = reader.lineNumber
  fun readLine(): String? = reader.readLine()
  fun unixNewlines(): Boolean = reader.lineTerminator.unixNewlines()
}

/**
 * Keep track of carriage return char to figure it out if we need unix new line or not. The first
 * line is kept in memory until we require the next line.
 */
private open class LineTerminatorAware(val lineTerminator: LineTerminatorReader) :
    LineNumberReader(lineTerminator) {
  /** First line is initialized as soon as possible. */
  private var firstLine: String? = super.readLine()
  override fun readLine(): String? {
    if (this.firstLine != null) {
      val result = this.firstLine
      this.firstLine = null
      return result
    }
    return super.readLine()
  }
}

/**
 * Override all read operations to find the carriage return. We want to keep lazy/incremental reads.
 */
private class LineTerminatorReader(reader: Reader) : BufferedReader(reader) {
  private val CR: Int = '\r'.code
  private var unixNewlines = true
  override fun read(cbuf: CharArray): Int {
    val result = super.read(cbuf)
    unixNewlines = cbuf.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(target: CharBuffer): Int {
    val result = super.read(target)
    unixNewlines = target.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(cbuf: CharArray, off: Int, len: Int): Int {
    val result = super.read(cbuf, off, len)
    unixNewlines = cbuf.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(): Int {
    val ch = super.read()
    if (ch == CR) {
      unixNewlines = false
    }
    return ch
  }
  fun unixNewlines(): Boolean {
    return unixNewlines
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

interface Roundtrip<T, SerializedForm> {
  fun serialize(value: T): SerializedForm
  fun parse(serialized: SerializedForm): T

  companion object {
    fun <T : Any> identity(): Roundtrip<T, T> = IDENTITY as Roundtrip<T, T>
    private val IDENTITY =
        object : Roundtrip<Any, Any> {
          override fun serialize(value: Any): Any = value
          override fun parse(serialized: Any): Any = serialized
        }
  }
}

/** Roundtrips the given type into pretty-printed Json. */
class RoundtripJson<T>(private val strategy: kotlinx.serialization.KSerializer<T>) :
    Roundtrip<T, String> {
  private val json =
      kotlinx.serialization.json.Json {
        prettyPrint = true
        prettyPrintIndent = "  "
      }
  override fun serialize(value: T): String = json.encodeToString(strategy, value)
  override fun parse(serialized: String): T = json.decodeFromString(strategy, serialized)

  companion object {
    inline fun <reified T> of() = RoundtripJson<T>(kotlinx.serialization.serializer())
  }
}
fun <T : java.io.Serializable> Selfie.cacheSelfieBinarySerializable(
    toCache: Cacheable<T>
): CacheSelfieBinary<T> =
    cacheSelfieBinary(SerializableRoundtrip as Roundtrip<T, ByteArray>, toCache)

internal object SerializableRoundtrip : Roundtrip<java.io.Serializable, ByteArray> {
  override fun serialize(value: java.io.Serializable): ByteArray {
    val output = ByteArrayOutputStream()
    ObjectOutputStream(output).use { it.writeObject(value) }
    return output.toByteArray()
  }
  override fun parse(serialized: ByteArray): java.io.Serializable {
    return java.io.ObjectInputStream(serialized.inputStream()).use {
      it.readObject() as java.io.Serializable
    }
  }
}

/**
 * If your escape policy is "'123", it means this:
 * ```
 * abc->abc
 * 123->'1'2'3
 * I won't->I won''t
 * ```
 */
class PerCharacterEscaper
/**
 * The first character in the string will be uses as the escape character, and all characters will
 * be escaped.
 */
private constructor(
    private val escapeCodePoint: Int,
    private val escapedCodePoints: IntArray,
    private val escapedByCodePoints: IntArray
) {
  private fun firstOffsetNeedingEscape(input: String): Int {
    val length = input.length
    var firstOffsetNeedingEscape = -1
    var offset = 0
    outer@ while (offset < length) {
      val codepoint = input.codePointAt(offset)
      for (escaped in escapedCodePoints) {
        if (codepoint == escaped) {
          firstOffsetNeedingEscape = offset
          break@outer
        }
      }
      offset += Character.charCount(codepoint)
    }
    return firstOffsetNeedingEscape
  }
  fun escape(input: String): String {
    val noEscapes = firstOffsetNeedingEscape(input)
    return if (noEscapes == -1) {
      input
    } else {
      val length = input.length
      val needsEscapes = length - noEscapes
      val builder = StringBuilder(noEscapes + 4 + needsEscapes * 5 / 4)
      builder.append(input, 0, noEscapes)
      var offset = noEscapes
      while (offset < length) {
        val codepoint = input.codePointAt(offset)
        offset += Character.charCount(codepoint)
        val idx = indexOf(escapedCodePoints, codepoint)
        if (idx == -1) {
          builder.appendCodePoint(codepoint)
        } else {
          builder.appendCodePoint(escapeCodePoint)
          builder.appendCodePoint(escapedByCodePoints[idx])
        }
      }
      builder.toString()
    }
  }
  private fun firstOffsetNeedingUnescape(input: String): Int {
    val length = input.length
    var firstOffsetNeedingEscape = -1
    var offset = 0
    while (offset < length) {
      val codepoint = input.codePointAt(offset)
      if (codepoint == escapeCodePoint) {
        firstOffsetNeedingEscape = offset
        break
      }
      offset += Character.charCount(codepoint)
    }
    return firstOffsetNeedingEscape
  }
  fun unescape(input: String): String {
    val noEscapes = firstOffsetNeedingUnescape(input)
    return if (noEscapes == -1) {
      input
    } else {
      val length = input.length
      val needsEscapes = length - noEscapes
      val builder = StringBuilder(noEscapes + 4 + needsEscapes * 5 / 4)
      builder.append(input, 0, noEscapes)
      var offset = noEscapes
      while (offset < length) {
        var codepoint = input.codePointAt(offset)
        offset += Character.charCount(codepoint)
        // if we need to escape something, escape it
        if (codepoint == escapeCodePoint) {
          if (offset < length) {
            codepoint = input.codePointAt(offset)
            val idx = indexOf(escapedByCodePoints, codepoint)
            if (idx != -1) {
              codepoint = escapedCodePoints[idx]
            }
            offset += Character.charCount(codepoint)
          } else {
            throw IllegalArgumentException(
                "Escape character '" +
                    String(intArrayOf(escapeCodePoint), 0, 1) +
                    "' can't be the last character in a string.")
          }
        }
        // we didn't escape it, append it raw
        builder.appendCodePoint(codepoint)
      }
      builder.toString()
    }
  }

  companion object {
    private fun indexOf(arr: IntArray, target: Int): Int {
      for ((index, value) in arr.withIndex()) {
        if (value == target) {
          return index
        }
      }
      return -1
    }
    /**
     * If your escape policy is `'123`, it means this: <br>
     *
     * ```
     * abc->abc
     * 123->'1'2'3
     * I won't->I won''t
     * ```
     */
    fun selfEscape(escapePolicy: String): PerCharacterEscaper {
      val escapedCodePoints = escapePolicy.codePoints().toArray()
      val escapeCodePoint = escapedCodePoints[0]
      return PerCharacterEscaper(escapeCodePoint, escapedCodePoints, escapedCodePoints)
    }

    /**
     * If your escape policy is `'a1b2c3d`, it means this: <br>
     *
     * ```
     * abc->abc
     * 123->'b'c'd
     * I won't->I won'at
     * ```
     */
    fun specifiedEscape(escapePolicy: String): PerCharacterEscaper {
      val codePoints = escapePolicy.codePoints().toArray()
      require(codePoints.size % 2 == 0)
      val escapeCodePoint = codePoints[0]
      val escapedCodePoints = IntArray(codePoints.size / 2)
      val escapedByCodePoints = IntArray(codePoints.size / 2)
      for (i in escapedCodePoints.indices) {
        escapedCodePoints[i] = codePoints[2 * i]
        escapedByCodePoints[i] = codePoints[2 * i + 1]
      }
      return PerCharacterEscaper(escapeCodePoint, escapedCodePoints, escapedByCodePoints)
    }
  }
}

enum class Mode {
  interactive,
  readonly,
  overwrite;
  internal fun canWrite(isTodo: Boolean, call: CallStack, system: SnapshotSystem): Boolean =
      when (this) {
        interactive -> isTodo || system.sourceFileHasWritableComment(call)
        readonly -> {
          if (system.sourceFileHasWritableComment(call)) {
            val layout = system.layout
            val path = layout.sourcePathForCall(call.location)
            val (comment, line) = CommentTracker.commentString(path, system.fs)
            throw system.fs.assertFailed(
                "Selfie is in readonly mode, so `$comment` is illegal at ${call.location.withLine(line).ideLink(layout)}")
          }
          false
        }
        overwrite -> true
      }
  internal fun msgSnapshotNotFound() = msg("Snapshot not found")
  internal fun msgSnapshotNotFoundNoSuchFile(file: TypedPath) =
      msg("Snapshot not found: no such file $file")
  internal fun msgSnapshotMismatch() = msg("Snapshot mismatch")
  private fun msg(headline: String) =
      when (this) {
        interactive ->
            "$headline\n" +
                "- update this snapshot by adding `_TODO` to the function name\n" +
                "- update all snapshots in this file by adding `//selfieonce` or `//SELFIEWRITE`"
        readonly -> headline
        overwrite -> "$headline\n(didn't expect this to ever happen in overwrite mode)"
      }
}

/**
 * A camera transforms a subject of a specific type into a [Snapshot] (tutorial for
 * [jvm](https://selfie.dev/jvm/advanced#typed-snapshots)).
 */
fun interface Camera<Subject> {
  fun snapshot(subject: Subject): Snapshot
  fun withLens(lens: Lens): Camera<Subject> {
    val parent = this
    return object : Camera<Subject> {
      override fun snapshot(subject: Subject): Snapshot = lens.transform(parent.snapshot(subject))
    }
  }

  companion object {
    @JvmStatic
    fun <Subject> of(camera: Camera<Subject>, lens: Lens): Camera<Subject> = camera.withLens(lens)
  }
}

/**
 * A lens transforms a single [Snapshot] into a new [Snapshot], transforming / creating / removing
 * [SnapshotValue]s along the way (tutorial for [jvm](https://selfie.dev/jvm/advanced#lenses)).
 */
fun interface Lens {
  fun transform(snapshot: Snapshot): Snapshot
}

/** A function which transforms a string into either another string or null. */
fun interface StringOptionalFunction {
  fun apply(value: String): String?
  fun then(next: StringOptionalFunction): StringOptionalFunction = StringOptionalFunction { outer ->
    apply(outer)?.let { inner -> next.apply(inner) }
  }
}

/**
 * A lens which makes it easy to pipe data from one facet to another within a snapshot (tutorial for
 * [jvm](https://selfie.dev/jvm/advanced#compound-lens)).
 */
open class CompoundLens : Lens {
  private val lenses = mutableListOf<Lens>()
  fun add(lens: Lens): CompoundLens {
    lenses.add(lens)
    return this
  }
  fun replaceAll(toReplace: String, replacement: String): CompoundLens = mutateAllFacets {
    it.replace(toReplace, replacement)
  }
  fun replaceAllRegex(regex: String, replacement: String): CompoundLens = mutateAllFacets {
    it.replace(regex.toRegex(), replacement)
  }
  fun mutateAllFacets(perString: StringOptionalFunction): CompoundLens = add { snapshot ->
    Snapshot.ofEntries(
        snapshot.allEntries().mapNotNull { e ->
          if (e.value.isBinary) e
          else
              perString.apply(e.value.valueString())?.let {
                java.util.Map.entry(e.key, SnapshotValue.of(it))
              }
        })
  }
  fun setFacetFrom(target: String, source: String, function: StringOptionalFunction) =
      add { snapshot ->
        val sourceValue = snapshot.subjectOrFacetMaybe(source)
        if (sourceValue == null) snapshot
        else setFacetOf(snapshot, target, function.apply(sourceValue.valueString()))
      }
  fun mutateFacet(target: String, function: StringOptionalFunction) =
      setFacetFrom(target, target, function)
  private fun setFacetOf(snapshot: Snapshot, target: String, newValue: String?): Snapshot =
      if (newValue == null) snapshot else snapshot.plusOrReplace(target, SnapshotValue.of(newValue))
  override fun transform(snapshot: Snapshot): Snapshot {
    var current = snapshot
    lenses.forEach { current = it.transform(current) }
    return current
  }
}

class CacheSelfieBinary<T>(
    private val disk: DiskStorage,
    private val roundtrip: Roundtrip<T, ByteArray>,
    private val generator: Cacheable<T>
) {
  fun toMatchDisk(sub: String = ""): T {
    return toMatchDiskImpl(sub, false)
  }
  fun toMatchDisk_TODO(sub: String = ""): T {
    return toMatchDiskImpl(sub, true)
  }
  private fun toMatchDiskImpl(sub: String, isTodo: Boolean): T {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(isTodo, call, Selfie.system)) {
      val actual = generator.get()
      disk.writeDisk(Snapshot.of(roundtrip.serialize(actual)), sub, call)
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toMatchDisk.createLiteral(), call)
      }
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed(
            "Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
      } else {
        val snapshot =
            disk.readDisk(sub, call)
                ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
        if (!snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
          throw Selfie.system.fs.assertFailed(
              "Expected a binary subject with no facets, got ${snapshot}")
        }
        return roundtrip.parse(snapshot.subject.valueBinary())
      }
    }
  }
  private fun resolvePath(subpath: String) = Selfie.system.layout.rootFolder.resolveFile(subpath)
  fun toBeFile_TODO(subpath: String): T {
    return toBeFileImpl(subpath, true)
  }
  fun toBeFile(subpath: String): T {
    return toBeFileImpl(subpath, false)
  }
  private fun toBeFileImpl(subpath: String, isTodo: Boolean): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(isTodo, call, Selfie.system)
    if (writable) {
      val actual = generator.get()
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toBeFile.createLiteral(), call)
      }
      Selfie.system.writeToBeFile(resolvePath(subpath), roundtrip.serialize(actual), call)
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed("Can't call `toBeFile_TODO` in ${Mode.readonly} mode!")
      } else {
        val path = resolvePath(subpath)
        if (!Selfie.system.fs.fileExists(path)) {
          throw Selfie.system.fs.assertFailed(
              Selfie.system.mode.msgSnapshotNotFoundNoSuchFile(path))
        }
        return roundtrip.parse(Selfie.system.fs.fileReadBinary(path))
      }
    }
  }
  fun toBeBase64_TODO(unusedArg: Any? = null): T {
    return toBeBase64Impl(null)
  }
  fun toBeBase64(snapshot: String): T {
    return toBeBase64Impl(snapshot)
  }

  @OptIn(ExperimentalEncodingApi::class)
  private fun toBeBase64Impl(snapshot: String?): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(snapshot == null, call, Selfie.system)
    if (writable) {
      val actual = generator.get()
      val base64 = Base64.Mime.encode(roundtrip.serialize(actual)).replace("\r", "")
      Selfie.system.writeInline(LiteralValue(snapshot, base64, LiteralString), call)
      return actual
    } else {
      if (snapshot == null) {
        throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        return roundtrip.parse(Base64.Mime.decode(snapshot))
      }
    }
  }
}

class CacheSelfie<T>(
    private val disk: DiskStorage,
    private val roundtrip: Roundtrip<T, String>,
    private val generator: Cacheable<T>
) {
  fun toMatchDisk(sub: String = ""): T {
    return toMatchDiskImpl(sub, false)
  }
  fun toMatchDisk_TODO(sub: String = ""): T {
    return toMatchDiskImpl(sub, true)
  }
  private fun toMatchDiskImpl(sub: String, isTodo: Boolean): T {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(isTodo, call, Selfie.system)) {
      val actual = generator.get()
      disk.writeDisk(Snapshot.of(roundtrip.serialize(actual)), sub, call)
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toMatchDisk.createLiteral(), call)
      }
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed(
            "Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
      } else {
        val snapshot =
            disk.readDisk(sub, call)
                ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
        if (snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
          throw Selfie.system.fs.assertFailed(
              "Expected a string subject with no facets, got ${snapshot}")
        }
        return roundtrip.parse(snapshot.subject.valueString())
      }
    }
  }
  fun toBe_TODO(unusedArg: Any? = null): T {
    return toBeImpl(null)
  }
  fun toBe(expected: String): T {
    return toBeImpl(expected)
  }
  private fun toBeImpl(snapshot: String?): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(snapshot == null, call, Selfie.system)
    if (writable) {
      val actual = generator.get()
      Selfie.system.writeInline(
          LiteralValue(snapshot, roundtrip.serialize(actual), LiteralString), call)
      return actual
    } else {
      if (snapshot == null) {
        throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        return roundtrip.parse(snapshot)
      }
    }
  }
}
private val STRING_SLASHFIRST =
    Comparator<String> { a, b ->
      var i = 0
      while (i < a.length && i < b.length) {
        val charA = a[i]
        val charB = b[i]
        if (charA != charB) {
          return@Comparator ( // treat
          if (charA == '/') -1 // slash as
          else if (charB == '/') 1 // the lowest
          else charA.compareTo(charB) // character
          )
        }
        i++
      }
      a.length.compareTo(b.length)
    }
private val PAIR_STRING_SLASHFIRST =
    Comparator<Pair<String, Any>> { a, b -> STRING_SLASHFIRST.compare(a.first, b.first) }

abstract class ListBackedSet<T>() : AbstractSet<T>() {
  abstract operator fun get(index: Int): T
  override fun iterator(): Iterator<T> =
      object : Iterator<T> {
        private var index = 0
        override fun hasNext(): Boolean = index < size
        override fun next(): T {
          if (!hasNext()) throw NoSuchElementException()
          return get(index++)
        }
      }
}
private fun <T : Comparable<T>> ListBackedSet<T>.binarySearch(element: T): Int {
  val list =
      object : AbstractList<T>() {
        override val size: Int
          get() = this@binarySearch.size
        override fun get(index: Int): T = this@binarySearch[index]
      }
  return if (element is String) {
    (list as List<String>).binarySearch(element, STRING_SLASHFIRST)
  } else list.binarySearch(element)
}

/**
 * An immutable, sorted, array-backed map - if keys are [String], they have a special sort order
 * where `/` is the lowest key.
 */
class ArrayMap<K : Comparable<K>, V : Any>(private val data: Array<Any>) : Map<K, V> {
  fun minusSortedIndices(indicesToRemove: List<Int>): ArrayMap<K, V> {
    if (indicesToRemove.isEmpty()) {
      return this
    }
    val newData = arrayOfNulls<Any>(data.size - indicesToRemove.size * 2)
    var newDataIdx = 0
    var currentPairIdx = 0 // Index for key-value pairs
    var toRemoveIdx = 0
    while (currentPairIdx < data.size / 2) {
      if (toRemoveIdx < indicesToRemove.size && currentPairIdx == indicesToRemove[toRemoveIdx]) {
        toRemoveIdx++
      } else {
        check(newDataIdx < newData.size) {
          "The indices weren't sorted or were >= size=$size: $indicesToRemove"
        }
        newData[newDataIdx++] = data[2 * currentPairIdx] // Copy key
        newData[newDataIdx++] = data[2 * currentPairIdx + 1] // Copy value
      }
      currentPairIdx++
    }

    // Ensure all indices to remove have been processed
    check(toRemoveIdx == indicesToRemove.size) {
      "The indices weren't sorted or were >= size($size): $indicesToRemove"
    }
    return ArrayMap<K, V>(newData as Array<Any>)
  }

  /**
   * Returns a new ArrayMap which has added the given key. Throws an exception if the key already
   * exists.
   */
  fun plus(key: K, value: V): ArrayMap<K, V> {
    val next = plusOrNoOp(key, value)
    if (next === this) {
      throw IllegalArgumentException("Key already exists: $key")
    }
    return next
  }
  /**
   * Returns a new ArrayMap which has added the given key, or the current map if the key was already
   * in the map.
   */
  fun plusOrNoOp(key: K, value: V): ArrayMap<K, V> {
    val idxExisting = dataAsKeys.binarySearch(key)
    return if (idxExisting >= 0) this
    else {
      val idxInsert = -(idxExisting + 1)
      insert(idxInsert, key, value)
    }
  }
  /**
   * Returns an ArrayMap which has added or overwritten the given key/value. If the map already
   * contained that mapping (equal keys and values) then it returns the identically same map.
   */
  fun plusOrNoOpOrReplace(key: K, newValue: V): ArrayMap<K, V> {
    val idxExisting = dataAsKeys.binarySearch(key)
    if (idxExisting >= 0) {
      val existingValue = data[idxExisting * 2 + 1] as V
      return if (newValue == existingValue) this
      else {
        val copy = data.copyOf()
        copy[idxExisting * 2 + 1] = newValue
        return ArrayMap(copy)
      }
    } else {
      val idxInsert = -(idxExisting + 1)
      return insert(idxInsert, key, newValue)
    }
  }
  private fun insert(idxInsert: Int, key: K, value: V): ArrayMap<K, V> {
    return when (data.size) {
      0 -> ArrayMap(arrayOf(key, value))
      1 -> {
        if (idxInsert == 0) ArrayMap(arrayOf(key, value, data[0], data[1]))
        else ArrayMap(arrayOf(data[0], data[1], key, value))
      }
      else ->
          // TODO: use idxInsert and arrayCopy to do this faster, see ArraySet#plusOrThis
          of(
              MutableList(size + 1) {
                if (it < size) Pair(data[it * 2] as K, data[it * 2 + 1] as V) else Pair(key, value)
              })
    }
  }
  /** list-backed set of guaranteed-sorted keys at even indices. */
  private val dataAsKeys =
      object : ListBackedSet<K>() {
        override val size: Int
          get() = data.size / 2
        override fun get(index: Int): K {
          return data[index * 2] as K
        }
      }
  override val keys: ListBackedSet<K>
    get() = dataAsKeys
  override fun get(key: K): V? {
    val idx = dataAsKeys.binarySearch(key)
    return if (idx < 0) null else data[idx * 2 + 1] as V
  }
  override fun containsKey(key: K): Boolean = dataAsKeys.binarySearch(key) >= 0
  /** list-backed collection of values at odd indices. */
  override val values: List<V>
    get() =
        object : AbstractList<V>() {
          override val size: Int
            get() = data.size / 2
          override fun get(index: Int): V = data[index * 2 + 1] as V
        }
  override fun containsValue(value: V): Boolean = values.contains(value)
  /** list-backed set of entries. */
  override val entries: ListBackedSet<Map.Entry<K, V>>
    get() =
        object : ListBackedSet<Map.Entry<K, V>>() {
          override val size: Int
            get() = data.size / 2
          override fun get(index: Int): Map.Entry<K, V> {
            val key = data[index * 2] as K
            val value = data[index * 2 + 1] as V
            return java.util.Map.entry(key, value)
          }
        }
  override val size: Int
    get() = data.size / 2
  override fun isEmpty(): Boolean = data.isEmpty()
  override fun equals(other: Any?): Boolean {
    if (other === this) return true
    if (other !is Map<*, *>) return false
    if (size != other.size) return false
    return if (other is ArrayMap<*, *>) {
      data.contentEquals(other.data)
    } else {
      other.entries.all { (key, value) -> this[key] == value }
    }
  }
  override fun hashCode(): Int = entries.hashCode()
  override fun toString() = this.toMutableMap().toString()

  companion object {
    private val EMPTY = ArrayMap<String, Any>(arrayOf())
    fun <K : Comparable<K>, V : Any> empty() = EMPTY as ArrayMap<K, V>
    fun <K : Comparable<K>, V : Any> of(pairs: MutableList<Pair<K, V>>): ArrayMap<K, V> {
      if (pairs.size > 1) {
        if (pairs[0].first is String) {
          (pairs as (MutableList<Pair<String, Any>>)).sortWith(PAIR_STRING_SLASHFIRST)
        } else {
          pairs.sortBy { it.first }
        }
      }
      val array = arrayOfNulls<Any>(pairs.size * 2)
      for (i in 0 until pairs.size) {
        array[i * 2] = pairs[i].first
        array[i * 2 + 1] = pairs[i].second
      }
      return ArrayMap(array as Array<Any>)
    }
  }
}

/**
 * An immutable, sorted, array-backed set - if keys are [String], they have a special sort order
 * where `/` is the lowest key.
 */
class ArraySet<K : Comparable<K>>(private val data: Array<Any>) : ListBackedSet<K>() {
  override val size: Int
    get() = data.size
  override fun get(index: Int): K = data[index] as K
  override fun contains(element: K): Boolean = binarySearch(element) >= 0
  fun plusOrThis(key: K): ArraySet<K> {
    val idxExisting = binarySearch(key)
    if (idxExisting >= 0) {
      return this
    }
    val idxInsert = -(idxExisting + 1)
    return when (data.size) {
      0 -> ArraySet(arrayOf(key))
      1 -> {
        if (idxInsert == 0)
            ArraySet(
                arrayOf(
                    key,
                    data[0],
                ))
        else ArraySet(arrayOf(data[0], key))
      }
      else -> {
        // TODO: use idxInsert and arrayCopy to do this faster, see ArrayMap#insert
        val array = Array(size + 1) { if (it < size) data[it] else key }
        if (key is String) {
          array.sortWith(STRING_SLASHFIRST as Comparator<Any>)
        } else {
          (array as Array<K>).sort()
        }
        ArraySet(array)
      }
    }
  }

  companion object {
    private val EMPTY = ArraySet<String>(arrayOf())
    fun <K : Comparable<K>> empty() = EMPTY as ArraySet<K>
  }
}
