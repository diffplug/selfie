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
import org.junit.jupiter.api.Assertions.assertEquals
import org.opentest4j.AssertionFailedError

/**
 * Sometimes a selfie is environment-specific, but should not be deleted when run in a different
 * environment.
 */
fun preserveSelfiesOnDisk(vararg subsToKeep: String): Unit {
  if (subsToKeep.isEmpty()) {
    Router.readOrWriteOrKeep(null, null)
  } else {
    for (sub in subsToKeep) {
      Router.readOrWriteOrKeep(null, sub)
    }
  }
}

open class DiskSelfie internal constructor(private val actual: Snapshot) {
  fun toMatchDisk(sub: String = ""): Snapshot {
    val onDisk = Router.readOrWriteOrKeep(actual, sub)
    if (RW.isWrite) return actual
    else if (onDisk == null) throw AssertionFailedError("No such snapshot")
    else if (actual.value != onDisk.value)
        throw AssertionFailedError("Snapshot failure", onDisk.value, actual.value)
    else if (actual.lenses.keys != onDisk.lenses.keys)
        throw AssertionFailedError(
            "Snapshot failure: mismatched lenses", onDisk.lenses.keys, actual.lenses.keys)
    for (key in actual.lenses.keys) {
      val actualValue = actual.lenses[key]!!
      val onDiskValue = onDisk.lenses[key]!!
      if (actualValue != onDiskValue) {
        throw AssertionFailedError("Snapshot failure within lens $key", onDiskValue, actualValue)
      }
    }
    // if we're in read mode and the equality checks passed, stick with the disk value
    return onDisk
  }
}
fun <T> expectSelfie(actual: T, snapshotter: Snapshotter<T>) =
    DiskSelfie(snapshotter.snapshot(actual))

class StringSelfie(private val actual: String) : DiskSelfie(Snapshot.of(actual)) {
  fun toBe(expected: String): String = TODO()
  fun toBe_TODO(): String = TODO()
}
fun expectSelfie(actual: String) = StringSelfie(actual)

class BinarySelfie(private val actual: ByteArray) : DiskSelfie(Snapshot.of(actual)) {
  fun toBeBase64(expected: String): ByteArray = TODO()
  fun toBeBase64_TODO(): ByteArray = TODO()
}
fun expectSelfie(actual: ByteArray) = BinarySelfie(actual)

class IntSelfie(private val actual: Int) : DiskSelfie(Snapshot.of(actual.toString())) {
  infix fun toBe(expected: Int): Int {
    // TODO: Is this right?
    val snapshot = toMatchDisk()
    assertEquals(expected, snapshot.value.valueString().toInt())
    return expected
  }
  fun toBe_TODO(): Int = TODO()
}
fun expectSelfie(actual: Int) = IntSelfie(actual)

class LongSelfie(private val actual: Long) {
  fun toBe(expected: Long): Long = TODO()
  fun toBe_TODO(): Long = TODO()
}
fun expectSelfie(actual: Long) = LongSelfie(actual)

class BooleanSelfie(private val actual: Boolean) {
  fun toBe(expected: Boolean): Boolean = TODO()
  fun toBe_TODO(): Boolean = TODO()
}
fun expectSelfie(actual: Boolean) = BooleanSelfie(actual)

// infix versions for the inline methods, consistent with Kotest's API
infix fun String.shouldBeSelfie(expected: String): String = expectSelfie(this).toBe(expected)
infix fun ByteArray.shouldBeSelfieBase64(expected: String): ByteArray =
    expectSelfie(this).toBeBase64(expected)
infix fun Int.shouldBeSelfie(expected: Int): Int = expectSelfie(this).toBe(expected)
infix fun Long.shouldBeSelfie(expected: Long): Long = expectSelfie(this).toBe(expected)
infix fun Boolean.shouldBeSelfie(expected: Boolean): Boolean = expectSelfie(this).toBe(expected)
