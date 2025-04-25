/*
 * Copyright (C) 2024-2025 DiffPlug
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

import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralBoolean
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralInt
import com.diffplug.selfie.guts.LiteralLong
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.TodoStub
import com.diffplug.selfie.guts.recordCall
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.jvm.JvmOverloads

/** A selfie which can be stored into a selfie-managed file. */
open class DiskSelfie internal constructor(val actual: Snapshot, protected val disk: DiskStorage) :
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

expect interface StringFacet : FluentFacet {
  fun toBe(expected: String): String
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
              Selfie.system.mode.msgSnapshotMismatchBinary(expected, actualBytes),
              expected,
              actualBytes)
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
internal fun serializeOnlyFacets(snapshot: Snapshot, keys: Collection<String>): String {
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
          Selfie.system.mode.msgSnapshotMismatch(expected.toString(), actual.toString()),
          expected,
          actual)
    }
  }
}
internal fun assertEqual(expected: Snapshot?, actual: Snapshot, storage: SnapshotSystem) {
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
      val expectedFacets = serializeOnlyFacets(expected, mismatchedKeys)
      val actualFacets = serializeOnlyFacets(actual, mismatchedKeys)
      throw storage.fs.assertFailed(
          storage.mode.msgSnapshotMismatch(expectedFacets, actualFacets),
          expectedFacets,
          actualFacets)
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
