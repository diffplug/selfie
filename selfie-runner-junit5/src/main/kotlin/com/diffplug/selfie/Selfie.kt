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

import com.diffplug.selfie.junit5.SnapshotStorageJUnit5
import java.util.Map.entry
import org.opentest4j.AssertionFailedError

/** NOT FOR ENDUSERS. Implemented by Selfie to integrate with various test frameworks. */
interface SnapshotStorage {
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

object Selfie {
  private val storage: SnapshotStorage = SnapshotStorageJUnit5

  /**
   * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
   * environment.
   */
  @JvmStatic
  fun preserveSelfiesOnDisk(vararg subsToKeep: String): Unit {
    if (subsToKeep.isEmpty()) {
      storage.keep(null)
    } else {
      subsToKeep.forEach { SnapshotStorageJUnit5.keep(it) }
    }
  }

  class DiskSelfie internal constructor(actual: Snapshot) : LiteralStringSelfie(actual) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): Snapshot {
      val comparison = storage.readWriteDisk(actual, sub)
      if (!SnapshotStorageJUnit5.isWrite) {
        comparison.assertEqual()
      }
      return comparison.actual
    }
  }

  open class LiteralStringSelfie
  internal constructor(
      protected val actual: Snapshot,
      private val onlyFacets: Collection<String>? = null
  ) {
    init {
      if (onlyFacets != null) {
        check(onlyFacets.all { it == "" || actual.facets.containsKey(it) }) {
          "The following facets were not found in the snapshot: ${onlyFacets.filter { actual.subjectOrFacetMaybe(it) == null }}\navailable facets are: ${actual.facets.keys}"
        }
        check(onlyFacets.isNotEmpty()) {
          "Must have at least one facet to display, this was empty."
        }
      }
    }
    /** Extract a single facet from a snapshot in order to do an inline snapshot. */
    fun facet(facet: String) = LiteralStringSelfie(actual, listOf(facet))
    /** Extract a multiple facets from a snapshot in order to do an inline snapshot. */
    fun facets(vararg facets: String) = LiteralStringSelfie(actual, facets.toList())
    private fun actualString(): String {
      if (actual.facets.isEmpty() || onlyFacets?.size == 1) {
        // single value doesn't have to worry about escaping at all
        val onlyValue = actual.subjectOrFacet(onlyFacets?.first() ?: "")
        return if (onlyValue.isBinary) {
          TODO("BASE64")
        } else onlyValue.valueString()
      } else {
        // multiple values might need our SnapshotFile escaping, we'll use it just in case
        val facetsToCheck =
            onlyFacets
                ?: buildList {
                  add("")
                  addAll(actual.facets.keys)
                }
        val snapshotToWrite =
            Snapshot.ofEntries(facetsToCheck.map { entry(it, actual.subjectOrFacet(it)) })
        return serializeMultiple(snapshotToWrite, !facetsToCheck.contains(""))
      }
    }
    fun toBe_TODO() = toBeDidntMatch(null, actualString(), LiteralString)
    infix fun toBe(expected: String): String {
      val actualString = actualString()
      return if (actualString == expected) actualString
      else toBeDidntMatch(expected, actualString, LiteralString)
    }
  }

  @JvmStatic
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))

  @JvmStatic fun expectSelfie(actual: Snapshot) = DiskSelfie(actual)

  @JvmStatic fun expectSelfie(actual: String) = DiskSelfie(Snapshot.of(actual))

  @JvmStatic fun expectSelfie(actual: ByteArray) = DiskSelfie(Snapshot.of(actual))

  /** Implements the inline snapshot whenever a match fails. */
  private fun <T : Any> toBeDidntMatch(expected: T?, actual: T, format: LiteralFormat<T>): T {
    if (SnapshotStorageJUnit5.isWrite) {
      storage.writeInline(LiteralValue(expected, actual, format))
      return actual
    } else {
      if (expected == null) {
        throw AssertionFailedError(
            "`.toBe_TODO()` was called in `read` mode, try again with selfie in write mode")
      } else {
        throw AssertionFailedError(
            "Inline literal did not match the actual value", expected, actual)
      }
    }
  }

  class IntSelfie(private val actual: Int) {
    fun toBe_TODO() = toBeDidntMatch(null, actual, LiteralInt)
    infix fun toBe(expected: Int) =
        if (actual == expected) expected else toBeDidntMatch(expected, actual, LiteralInt)
  }

  @JvmStatic fun expectSelfie(actual: Int) = IntSelfie(actual)

  class LongSelfie(private val actual: Long) {
    fun toBe(expected: Long): Long = TODO()
    fun toBe_TODO(): Long = TODO()
  }

  @JvmStatic fun expectSelfie(actual: Long) = LongSelfie(actual)

  class BooleanSelfie(private val actual: Boolean) {
    fun toBe(expected: Boolean): Boolean = TODO()
    fun toBe_TODO(): Boolean = TODO()
  }

  @JvmStatic fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)

  // infix versions for the inline methods, consistent with Kotest's API
  infix fun String.shouldBeSelfie(expected: String): String = expectSelfie(this).toBe(expected)
  infix fun ByteArray.shouldBeSelfieBase64(expected: String): String =
      expectSelfie(this).toBe(expected)
  infix fun Int.shouldBeSelfie(expected: Int): Int = expectSelfie(this).toBe(expected)
  infix fun Long.shouldBeSelfie(expected: Long): Long = expectSelfie(this).toBe(expected)
  infix fun Boolean.shouldBeSelfie(expected: Boolean): Boolean = expectSelfie(this).toBe(expected)
}

class ExpectedActual(val expected: Snapshot?, val actual: Snapshot) {
  fun assertEqual() {
    if (expected == null) {
      throw AssertionFailedError("No such snapshot")
    } else if (expected.subject == actual.subject && expected.facets == actual.facets) {
      return
    } else {
      val allKeys =
          mutableSetOf<String>()
              .apply {
                add("")
                addAll(expected.facets.keys)
                addAll(actual.facets.keys)
              }
              .toList()
              .sorted()
      val mismatchInExpected = mutableMapOf<String, SnapshotValue>()
      val mismatchInActual = mutableMapOf<String, SnapshotValue>()
      for (key in allKeys) {
        val expectedValue = expected.facets[key]
        val actualValue = actual.facets[key]
        if (expectedValue != actualValue) {
          expectedValue?.let { mismatchInExpected[key] = it }
          actualValue?.let { mismatchInActual[key] = it }
        }
      }
      val includeRoot = mismatchInExpected.containsKey("")
      throw AssertionFailedError(
          "Snapshot failure",
          serializeMultiple(Snapshot.ofEntries(mismatchInExpected.entries), !includeRoot),
          serializeMultiple(Snapshot.ofEntries(mismatchInActual.entries), !includeRoot))
    }
  }
}
private fun serializeMultiple(actual: Snapshot, removeEmptySubject: Boolean): String {
  if (removeEmptySubject) {
    check(actual.subject.valueString().isEmpty()) {
      "The subject was expected to be empty, was '${actual.subject.valueString()}'"
    }
  }
  val file = SnapshotFile()
  file.snapshots = ArrayMap.of(mutableListOf("" to actual))
  val buf = StringBuilder()
  file.serialize(buf::append)

  check(buf.startsWith(EMPTY_SUBJECT))
  check(buf.endsWith(EOF))
  buf.setLength(buf.length - EOF.length)
  val str = buf.substring(EMPTY_SUBJECT.length)
  return if (!removeEmptySubject) str
  else {
    check(str[0] == '\n')
    str.substring(1)
  }
}

private const val EMPTY_SUBJECT = "╔═  ═╗\n"
private const val EOF = "\n╔═ [end of file] ═╗\n"
