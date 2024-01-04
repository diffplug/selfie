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

import com.diffplug.selfie.guts.DiskSnapshotTodo
import com.diffplug.selfie.guts.LiteralBoolean
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralInt
import com.diffplug.selfie.guts.LiteralLong
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotStorage
import com.diffplug.selfie.guts.initStorage
import kotlin.jvm.JvmOverloads
import kotlin.jvm.JvmStatic

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

    @JvmOverloads
    fun toMatchDisk_TODO(sub: String = ""): DiskSelfie {
      if (!storage.isWrite) {
        throw storage.fs.assertFailed("Can't call `toMatchDisk_TODO` in readonly mode!")
      }
      storage.readWriteDisk(actual, sub)
      storage.writeInline(DiskSnapshotTodo.createLiteral())
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

    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actualString(), LiteralString)
    fun toBe(expected: String): String {
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
        throw storage.fs.assertFailed(
            "`.toBe_TODO()` was called in `read` mode, try again with selfie in write mode")
      } else {
        throw storage.fs.assertFailed(
            "Inline literal did not match the actual value", expected, actual)
      }
    }
  }

  class IntSelfie(private val actual: Int) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralInt)
    fun toBe(expected: Int) =
        if (actual == expected) expected else toBeDidntMatch(expected, actual, LiteralInt)
  }

  @JvmStatic fun expectSelfie(actual: Int) = IntSelfie(actual)

  class LongSelfie(private val actual: Long) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralLong)
    fun toBe(expected: Long) =
        if (actual == expected) expected else toBeDidntMatch(expected, actual, LiteralLong)
  }

  @JvmStatic fun expectSelfie(actual: Long) = LongSelfie(actual)

  class BooleanSelfie(private val actual: Boolean) {
    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralBoolean)
    fun toBe(expected: Boolean) =
        if (actual == expected) expected else toBeDidntMatch(expected, actual, LiteralBoolean)
  }

  @JvmStatic fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)
}

class ExpectedActual(val expected: Snapshot?, val actual: Snapshot) {
  internal fun assertEqual(storage: SnapshotStorage) {
    if (expected == null) {
      throw storage.fs.assertFailed("No such snapshot")
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
      throw storage.fs.assertFailed(
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
