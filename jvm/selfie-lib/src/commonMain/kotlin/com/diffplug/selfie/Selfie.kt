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
import com.diffplug.selfie.guts.DiskSnapshotTodo
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralBoolean
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralInt
import com.diffplug.selfie.guts.LiteralLong
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.initSnapshotSystem
import com.diffplug.selfie.guts.recordCall
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.jvm.JvmOverloads
import kotlin.jvm.JvmStatic

/**
 * Used for creating snapshots which are independent of the thread or coroutine on which the test
 * started. See the [threading details](http://localhost:3000/jvm/kotest#threading-details) for more
 * info.
 */
class SelfieBound internal constructor(private val disk: DiskStorage) {
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))
  fun expectSelfie(actual: String) = expectSelfie(Snapshot.of(actual))
  fun expectSelfie(actual: ByteArray) = expectSelfie(Snapshot.of(actual))
  fun expectSelfie(actual: Snapshot) = Selfie.DiskSelfie(actual, disk)
  fun preserveSelfiesOnDisk(vararg subsToKeep: String) {
    if (subsToKeep.isEmpty()) {
      disk.keep(null)
    } else {
      subsToKeep.forEach { disk.keep(it) }
    }
  }
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
    bind().preserveSelfiesOnDisk(*subsToKeep)
  }

  /**
   * Used to bind to the currently executing test so that you can create disk selfies in other
   * threads and coroutines if you want.
   */
  @JvmStatic fun bind() = SelfieBound(system.diskThreadLocal())

  class DiskSelfie internal constructor(actual: Snapshot, val disk: DiskStorage) :
      LiteralStringSelfie(actual) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): DiskSelfie {
      val call = recordCall(false)
      if (system.mode.canWrite(false, call, system)) {
        disk.writeDisk(actual, sub, call)
      } else {
        assertEqual(disk.readDisk(sub, call), actual, system)
      }
      return this
    }

    @JvmOverloads
    fun toMatchDisk_TODO(sub: String = ""): DiskSelfie {
      val call = recordCall(false)
      if (system.mode.canWrite(true, call, system)) {
        disk.writeDisk(actual, sub, call)
        system.writeInline(DiskSnapshotTodo.createLiteral(), call)
        return this
      } else {
        throw system.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
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

    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actualString(), LiteralString)
    fun toBe(expected: String): String {
      val actualString = actualString()
      return if (actualString == expected) system.checkSrc(actualString)
      else toBeDidntMatch(expected, actualString, LiteralString)
    }
  }

  @JvmStatic
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))

  @JvmStatic fun expectSelfie(actual: String) = expectSelfie(Snapshot.of(actual))

  @JvmStatic fun expectSelfie(actual: ByteArray) = expectSelfie(Snapshot.of(actual))

  @JvmStatic fun expectSelfie(actual: Snapshot) = DiskSelfie(actual, deferredDiskStorage)

  /** Implements the inline snapshot whenever a match fails. */
  private fun <T : Any> toBeDidntMatch(expected: T?, actual: T, format: LiteralFormat<T>): T {
    val call = recordCall(false)
    val writable = system.mode.canWrite(expected == null, call, system)
    if (writable) {
      system.writeInline(LiteralValue(expected, actual, format), call)
      return actual
    } else {
      if (expected == null) {
        throw system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        throw system.fs.assertFailed(system.mode.msgSnapshotMismatch(), expected, actual)
      }
    }
  }

  class IntSelfie(private val actual: Int) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralInt)
    fun toBe(expected: Int) =
        if (actual == expected) system.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralInt)
  }

  @JvmStatic fun expectSelfie(actual: Int) = IntSelfie(actual)

  class LongSelfie(private val actual: Long) {
    @JvmOverloads fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralLong)
    fun toBe(expected: Long) =
        if (actual == expected) system.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralLong)
  }

  @JvmStatic fun expectSelfie(actual: Long) = LongSelfie(actual)

  class BooleanSelfie(private val actual: Boolean) {
    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) = toBeDidntMatch(null, actual, LiteralBoolean)
    fun toBe(expected: Boolean) =
        if (actual == expected) system.checkSrc(actual)
        else toBeDidntMatch(expected, actual, LiteralBoolean)
  }

  @JvmStatic fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)
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
   * Returns a serialized form of only the given facets if they are available, silently omits
   * missing facets.
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
}

/**
 * Checks that the sourcecode of the given inline snapshot value doesn't have control comments when
 * in readonly mode.
 */
private fun <T> SnapshotSystem.checkSrc(value: T): T {
  mode.canWrite(false, recordCall(true), this)
  return value
}
