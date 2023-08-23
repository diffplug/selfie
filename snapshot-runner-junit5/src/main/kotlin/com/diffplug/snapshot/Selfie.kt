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
package com.diffplug.snapshot
fun preserveScenarios(vararg names: String): Unit = TODO()

open class DiskSelfie internal constructor(private val actual: Snapshot) {
  fun shouldMatchDisk(scenario: String = ""): Snapshot = TODO()
}
fun <T> selfie(actual: T, snapshotter: Snapshotter<T>) = DiskSelfie(snapshotter.snapshot(actual))

class StringSelfie(private val actual: String) : DiskSelfie(Snapshot.of(actual)) {
  fun shouldBe(expected: String): String = TODO()
}
fun selfie(actual: String) = StringSelfie(actual)

class BinarySelfie(private val actual: ByteArray) : DiskSelfie(Snapshot.of(actual)) {
  fun shouldBeBase64(expected: String): String = TODO()
}
fun selfie(actual: ByteArray) = BinarySelfie(actual)

class IntSelfie(private val actual: Int) {
  fun shouldBe(expected: Int): Int = TODO()
}
fun selfie(actual: Int) = IntSelfie(actual)

class LongSelfie(private val actual: Long) {
  fun shouldBe(expected: Long): Long = TODO()
}
fun selfie(actual: Long) = LongSelfie(actual)

class BooleanSelfie(private val actual: Boolean) {
  fun shouldBe(expected: Boolean): Boolean = TODO()
}
fun selfie(actual: Boolean) = BooleanSelfie(actual)
