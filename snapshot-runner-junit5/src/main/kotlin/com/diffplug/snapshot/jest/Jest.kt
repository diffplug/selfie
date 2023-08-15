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
package com.diffplug.snapshot.jest

import com.diffplug.snapshot.Snapshot
import com.diffplug.snapshot.Snapshotter
fun preserveScenarios(vararg names: String): Unit = TODO()

class Expect(private val actual: Snapshot) {
  fun toMatchLiteral(actual: String): String = TODO()
  fun toMatchSnapshot(scenario: String = ""): String = TODO()
}
fun expect(actual: String) = Expect(Snapshot.of(actual))
fun <T> expect(actual: T, snapshotter: Snapshotter<T>) = Expect(snapshotter.snapshot(actual))

class BinaryExpect(private val actual: ByteArray) {
  fun toMatchSnapshot(scenario: String = ""): ByteArray = TODO()
}
fun expect(actual: ByteArray) = BinaryExpect(actual)

class IntExpect(private val actual: Int) {
  fun toMatchLiteral(expected: Int): Int = TODO()
}
fun expect(actual: Int) = IntExpect(actual)

class LongExpect(private val actual: Long) {
  fun toMatchLiteral(expected: Long): Long = TODO()
}
fun expect(actual: Long) = LongExpect(actual)

class BooleanExpect(private val actual: Boolean) {
  fun toMatchLiteral(expected: Boolean): Boolean = TODO()
}
fun expect(actual: Boolean) = BooleanExpect(actual)
