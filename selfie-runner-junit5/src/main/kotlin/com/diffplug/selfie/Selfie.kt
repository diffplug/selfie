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

import com.diffplug.selfie.junit5.Router
import com.diffplug.selfie.junit5.recordCall
import java.util.Map.entry
import org.opentest4j.AssertionFailedError

object Selfie {
  /**
   * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
   * environment.
   */
  @JvmStatic
  fun preserveSelfiesOnDisk(vararg subsToKeep: String): Unit {
    if (subsToKeep.isEmpty()) {
      Router.keep(null)
    } else {
      subsToKeep.forEach { Router.keep(it) }
    }
  }

  class DiskSelfie internal constructor(actual: Snapshot) : LiteralStringSelfie(actual) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): Snapshot {
      val comparison = Router.readWriteThroughPipeline(actual, sub)
      if (!RW.isWrite) {
        comparison.assertEqual()
      }
      return comparison.actual
    }
  }

  open class LiteralStringSelfie
  internal constructor(protected val actual: Snapshot, val onlyLenses: Collection<String>? = null) {
    init {
      if (onlyLenses != null) {
        check(onlyLenses.all { it == "" || actual.lenses.containsKey(it) }) {
          "The following lenses were not found in the snapshot: ${onlyLenses.filter { actual.valueOrLensMaybe(it) == null }}\navailable lenses are: ${actual.lenses.keys}"
        }
        check(onlyLenses.size > 1) { "Must have at least one lens, this was empty." }
      }
    }
    /** Extract a single lens from a snapshot in order to do an inline snapshot. */
    fun lens(lensName: String) = LiteralStringSelfie(actual, listOf(lensName))
    /** Extract a multiple lenses from a snapshot in order to do an inline snapshot. */
    fun lenses(vararg lensNames: String) = LiteralStringSelfie(actual, lensNames.toList())
    private fun actualString(): String {
      if ((onlyLenses == null && actual.lenses.isEmpty()) || actual.lenses.size == 1) {
        // single value doesn't have to worry about escaping at all
        val onlyValue =
            actual.run { if (lenses.isEmpty()) value else lenses[onlyLenses!!.first()]!! }
        if (onlyValue.isBinary) {
          throw Error("Cannot use `toBe` with binary data, use `toBeBase64` instead")
        }
        return onlyValue.valueString()
      } else {
        // multiple values might need our SnapshotFile escaping, we'll use it just in case
        val snapshotToWrite =
            if (onlyLenses == null) actual
            else Snapshot.ofEntries(onlyLenses.map { entry(it, actual.valueOrLens(it)) })
        snapshotToWrite.allEntries().forEach {
          if (it.value.isBinary) {
            throw Error(
                "Cannot use `toBe` with binary data, use `toBeBase64` instead, key='${it.key}' was binary")
          }
        }
        val file = SnapshotFile()
        file.snapshots = ArrayMap.of(mutableListOf("" to snapshotToWrite))
        val buf = StringBuilder()
        file.serialize(buf::append)
        val removeEmptyRoot = onlyLenses != null && !onlyLenses.contains("")
        val str = buf.toString()
        return if (removeEmptyRoot) str else str
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
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = DiskSelfie(camera.snapshot(actual))

  @JvmStatic fun expectSelfie(actual: String) = DiskSelfie(Snapshot.of(actual))

  @JvmStatic fun expectSelfie(actual: ByteArray) = DiskSelfie(Snapshot.of(actual))

  /** Implements the inline snapshot whenever a match fails. */
  private fun <T : Any> toBeDidntMatch(expected: T?, actual: T, format: LiteralFormat<T>): T {
    if (RW.isWrite) {
      Router.writeInline(recordCall(), LiteralValue(expected, actual, format))
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

internal class ExpectedActual(val expected: Snapshot?, val actual: Snapshot) {
  fun assertEqual() {
    if (expected == null) {
      throw AssertionFailedError("No such snapshot")
    }
    if (expected.value != actual.value)
        throw AssertionFailedError("Snapshot failure", expected.value, actual.value)
    else if (expected.lenses.keys != actual.lenses.keys)
        throw AssertionFailedError(
            "Snapshot failure: mismatched lenses", expected.lenses.keys, actual.lenses.keys)
    for (key in expected.lenses.keys) {
      val expectedValue = expected.lenses[key]!!
      val actualValue = actual.lenses[key]!!
      if (actualValue != expectedValue) {
        throw AssertionFailedError("Snapshot failure within lens $key", expectedValue, actualValue)
      }
    }
  }
}
