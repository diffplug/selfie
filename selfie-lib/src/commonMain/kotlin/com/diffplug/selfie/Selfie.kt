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
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.LiteralBoolean
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralInt
import com.diffplug.selfie.guts.LiteralLong
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotStorage
import com.diffplug.selfie.guts.initStorage
import com.diffplug.selfie.guts.recordCall
import kotlin.jvm.JvmOverloads
import kotlin.jvm.JvmStatic

object Selfie {
  private val storage: SnapshotStorage = initStorage()

  /**
   * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
   * environment.
   */
  @JvmStatic
  fun preserveSelfiesOnDisk(vararg subsToKeep: String) {
    if (subsToKeep.isEmpty()) {
      storage.keep(null)
    } else {
      subsToKeep.forEach { storage.keep(it) }
    }
  }

  class DiskSelfie internal constructor(actual: Snapshot) : LiteralStringSelfie(actual) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): DiskSelfie {
      val call = recordCall(false)
      if (storage.mode.canWrite(false, call, storage)) {
        storage.writeDisk(actual, sub, call)
      } else {
        assertEqual(storage.readDisk(sub, call), actual, storage.fs)
      }
      return this
    }

    @JvmOverloads
    fun toMatchDisk_TODO(sub: String = ""): DiskSelfie {
      val call = recordCall(false)
      if (storage.mode.canWrite(true, call, storage)) {
        storage.writeDisk(actual, sub, call)
        storage.writeInline(DiskSnapshotTodo.createLiteral(), call)
        return this
      } else {
        throw storage.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
      }
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
                ?: buildList {
                  add("")
                  addAll(actual.facets.keys)
                })
      }
    }

    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actualString(), LiteralString)
    fun toBe(expected: String): String {
      val actualString = actualString()
      return if (actualString == expected) storage.checkSrc(actualString)
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
    val call = recordCall(false)
    val writable = storage.mode.canWrite(expected == null, call, storage)
    if (writable) {
      storage.writeInline(LiteralValue(expected, actual, format), call)
      return actual
    } else {
      if (expected == null) {
        throw storage.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        throw storage.fs.assertFailed(
            "Inline literal did not match the actual value", expected, actual)
      }
    }
  }

  class IntSelfie(private val actual: Int) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralInt)
    fun toBe(expected: Int) =
        if (actual == expected) storage.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralInt)
  }

  @JvmStatic fun expectSelfie(actual: Int) = IntSelfie(actual)

  class LongSelfie(private val actual: Long) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralLong)
    fun toBe(expected: Long) =
        if (actual == expected) storage.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralLong)
  }

  @JvmStatic fun expectSelfie(actual: Long) = LongSelfie(actual)

  class BooleanSelfie(private val actual: Boolean) {
    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralBoolean)
    fun toBe(expected: Boolean) =
        if (actual == expected) storage.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralBoolean)
  }

  @JvmStatic fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)
  private fun assertEqual(expected: Snapshot?, actual: Snapshot, fs: FS) {
    if (expected == null) {
      throw fs.assertFailed("No such snapshot")
    } else if (expected == actual) {
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
      throw fs.assertFailed(
          "Snapshot failure",
          serializeOnlyFacets(expected, mismatchedKeys),
          serializeOnlyFacets(actual, mismatchedKeys))
    }
  }

  /**
   * Returns a serialized form of only the given facets if they are available, silently omits
   * missing facets.
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
}

/**
 * Checks that the sourcecode of the given inline snapshot value doesn't have control comments when
 * in readonly mode.
 */
private fun <T> SnapshotStorage.checkSrc(value: T): T {
  mode.canWrite(false, recordCall(true), this)
  return value
}
