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

import kotlin.jvm.JvmOverloads
import kotlin.jvm.JvmStatic

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
  /** Creates an assertion failed exception to throw. */
  fun assertFailed(message: String, expected: Any? = null, actual: Any? = null): Error
}

expect fun initStorage(): SnapshotStorage

object Selfie {
  private val storage: SnapshotStorage = initStorage()

  /**
   * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
   * environment.
   */
  @JvmStatic
  fun preserveSelfiesOnDisk(vararg subsToKeep: String): Unit {
    if (subsToKeep.isEmpty()) {
      storage.keep(null)
    } else {
      subsToKeep.forEach { storage.keep(it) }
    }
  }

  class DiskSelfie internal constructor(actual: Snapshot) : LiteralStringSelfie(actual) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): DiskSelfie {
      val comparison = storage.readWriteDisk(actual, sub)
      if (!storage.isWrite) {
        comparison.assertEqual(storage)
      }
      return this
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
        if (onlyFacets.contains("")) {
          check(onlyFacets.indexOf("") == 0) {
            "If you're going to specify the subject facet (\"\"), you have to list it first, this was $onlyFacets"
          }
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
        return serializeOnlyFacets(
            actual,
            onlyFacets
                ?: buildList<String> {
                  add("")
                  addAll(actual.facets.keys)
                })
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
    if (storage.isWrite) {
      storage.writeInline(LiteralValue(expected, actual, format))
      return actual
    } else {
      if (expected == null) {
        throw storage.assertFailed(
            "`.toBe_TODO()` was called in `read` mode, try again with selfie in write mode")
      } else {
        throw storage.assertFailed(
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
    fun toBe_TODO() = toBeDidntMatch(null, actual, LiteralBoolean)
    infix fun toBe(expected: Boolean) =
        if (actual == expected) expected else toBeDidntMatch(expected, actual, LiteralBoolean)
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
  internal fun assertEqual(storage: SnapshotStorage) {
    if (expected == null) {
      throw storage.assertFailed("No such snapshot")
    } else if (expected.subject == actual.subject && expected.facets == actual.facets) {
      return
    } else {
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
      throw storage.assertFailed(
          "Snapshot failure",
          serializeOnlyFacets(expected, mismatchedKeys),
          serializeOnlyFacets(actual, mismatchedKeys))
    }
  }
}
/**
 * Returns a serialized form of only the given facets if they are available, silently omits missing
 * facets.
 */
private fun serializeOnlyFacets(snapshot: Snapshot, keys: Collection<String>): String {
  val buf = StringBuilder()
  val writer = StringWriter { buf.append(it) }
  for (key in keys) {
    if (key.isEmpty()) {
      SnapshotFile.writeValue(writer, snapshot.subjectOrFacet(key))
    } else {
      snapshot.subjectOrFacetMaybe(key)?.let {
        SnapshotFile.writeKey(writer, "", key)
        SnapshotFile.writeValue(writer, it)
      }
    }
  }
  buf.setLength(buf.length - 1)
  return buf.toString()
}
