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

  open class DiskSelfie internal constructor(private val actual: Snapshot) {
    @JvmOverloads
    fun toMatchDisk(sub: String = ""): Snapshot {
      val comparison = Router.readWriteThroughPipeline(actual, sub)
      if (!RW.isWrite) {
        comparison.assertEqual()
      }
      return comparison.actual
    }
  }

  @JvmStatic
  fun <T> expectSelfie(actual: T, camera: Camera<T>) = DiskSelfie(camera.snapshot(actual))

  class StringSelfie(private val actual: String) : DiskSelfie(Snapshot.of(actual)) {
    fun toBe(expected: String): String = TODO()
    fun toBe_TODO(): String = TODO()
  }

  @JvmStatic fun expectSelfie(actual: String) = StringSelfie(actual)

  class BinarySelfie(private val actual: ByteArray) : DiskSelfie(Snapshot.of(actual)) {
    fun toBeBase64(expected: String): ByteArray = TODO()
    fun toBeBase64_TODO(): ByteArray = TODO()
  }

  @JvmStatic fun expectSelfie(actual: ByteArray) = BinarySelfie(actual)

  class IntSelfie(private val actual: Int) {
    fun toBe_TODO(): Int = toBeDidntMatch(null)
    infix fun toBe(expected: Int): Int =
        if (actual == expected) expected
        else {
          toBeDidntMatch(expected)
        }
    private fun toBeDidntMatch(expected: Int?): Int {
      if (RW.isWrite) {
        Router.writeInline(recordCall(), LiteralValue(expected, actual, IntFormat()))
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
  infix fun ByteArray.shouldBeSelfieBase64(expected: String): ByteArray =
      expectSelfie(this).toBeBase64(expected)
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
