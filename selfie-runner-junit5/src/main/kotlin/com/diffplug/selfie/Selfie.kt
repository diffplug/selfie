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

open class DiskSelfie internal constructor(private val actual: Snapshot) {
  fun toMatchDisk(scenario: String = ""): Snapshot = TODO()
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

class IntSelfie(private val actual: Int) {
  fun toBe(expected: Int): Int = TODO()
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

/** Sometimes a selfie doesn't get used. */
fun preserveDiskSelfies(vararg names: String): Unit = TODO()

// infix versions for the inline methods, consistent with Kotest's API
infix fun String.shouldBeSelfie(expected: String): String = expectSelfie(this).toBe(expected)
infix fun ByteArray.shouldBeSelfieBase64(expected: String): ByteArray =
    expectSelfie(this).toBeBase64(expected)
infix fun Int.shouldBeSelfie(expected: Int): Int = expectSelfie(this).toBe(expected)
infix fun Long.shouldBeSelfie(expected: Long): Long = expectSelfie(this).toBe(expected)
infix fun Boolean.shouldBeSelfie(expected: Boolean): Boolean = expectSelfie(this).toBe(expected)
