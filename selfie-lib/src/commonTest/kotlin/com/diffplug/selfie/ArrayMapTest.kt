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

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import kotlin.test.Test
import kotlin.test.assertFails

class ArrayMapTest {
  @Test
  fun empty() {
    val empty = ArrayMap.empty<String, String>()
    assertEmpty(empty)
  }

  @Test
  fun single() {
    val empty = ArrayMap.empty<String, String>()
    val single = empty.plus("one", "1")
    assertEmpty(empty)
    assertSingle(single, "one", "1")
  }

  @Test
  fun double() {
    val empty = ArrayMap.empty<String, String>()
    val single = empty.plus("one", "1")
    val double = single.plus("two", "2")
    assertEmpty(empty)
    assertSingle(single, "one", "1")
    assertDouble(double, "one", "1", "two", "2")
    // ensure sorted also
    assertDouble(single.plus("a", "sorted"), "a", "sorted", "one", "1")

    shouldThrow<IllegalArgumentException> { single.plus("one", "2") }.message shouldBe
        "Key already exists: one"
  }

  @Test
  fun of() {
    assertEmpty(ArrayMap.of(mutableListOf<Pair<String, String>>()))
    assertSingle(ArrayMap.of(mutableListOf("one" to "1")), "one", "1")
    assertDouble(ArrayMap.of(mutableListOf("one" to "1", "two" to "2")), "one", "1", "two", "2")
    assertDouble(ArrayMap.of(mutableListOf("two" to "2", "one" to "1")), "one", "1", "two", "2")
  }

  @Test
  fun multi() {
    assertTriple(
        ArrayMap.empty<String, String>().plus("1", "one").plus("2", "two").plus("3", "three"),
        "1",
        "one",
        "2",
        "two",
        "3",
        "three")
    assertTriple(
        ArrayMap.empty<String, String>().plus("2", "two").plus("3", "three").plus("1", "one"),
        "1",
        "one",
        "2",
        "two",
        "3",
        "three")
    assertTriple(
        ArrayMap.empty<String, String>().plus("3", "three").plus("1", "one").plus("2", "two"),
        "1",
        "one",
        "2",
        "two",
        "3",
        "three")
  }
  private fun assertEmpty(map: ArrayMap<String, String>) {
    map.size shouldBe 0
    map.keys shouldBe emptySet()
    map.values shouldBe emptyList()
    map.entries shouldBe emptySet()
    map["key"] shouldBe null
    map shouldBe mapOf()
    map shouldBe ArrayMap.empty()
  }
  private fun assertSingle(map: ArrayMap<String, String>, key: String, value: String) {
    map.size shouldBe 1
    map.keys shouldBe setOf(key)
    map.values shouldBe listOf(value)
    map.entries shouldBe setOf(entry(key, value))
    map[key] shouldBe value
    map[key + "blah"] shouldBe null
    map shouldBe mapOf(key to value)
    map shouldBe ArrayMap.empty<String, String>().plus(key, value)
  }
  private fun assertDouble(
      map: ArrayMap<String, String>,
      key1: String,
      value1: String,
      key2: String,
      value2: String
  ) {
    map.size shouldBe 2
    map.keys shouldBe setOf(key1, key2)
    map.values shouldBe listOf(value1, value2)
    map.entries shouldBe setOf(entry(key1, value1), entry(key2, value2))
    map[key1] shouldBe value1
    map[key2] shouldBe value2
    map[key1 + "blah"] shouldBe null
    map shouldBe mapOf(key1 to value1, key2 to value2)
    map shouldBe mapOf(key2 to value2, key1 to value1)
    map shouldBe ArrayMap.empty<String, String>().plus(key1, value1).plus(key2, value2)
    map shouldBe ArrayMap.empty<String, String>().plus(key2, value2).plus(key1, value1)
  }
  private fun assertTriple(
      map: ArrayMap<String, String>,
      key1: String,
      value1: String,
      key2: String,
      value2: String,
      key3: String,
      value3: String
  ) {
    map.size shouldBe 3
    map.keys shouldBe setOf(key1, key2, key3)
    map.values shouldBe listOf(value1, value2, value3)
    map.entries shouldBe setOf(entry(key1, value1), entry(key2, value2), entry(key3, value3))
    map[key1] shouldBe value1
    map[key2] shouldBe value2
    map[key3] shouldBe value3
    map[key1 + "blah"] shouldBe null
    map shouldBe mapOf(key1 to value1, key2 to value2, key3 to value3)
    map shouldBe mapOf(key2 to value2, key1 to value1, key3 to value3)
    map shouldBe
        ArrayMap.empty<String, String>().plus(key1, value1).plus(key2, value2).plus(key3, value3)
    map shouldBe
        ArrayMap.empty<String, String>().plus(key2, value2).plus(key1, value1).plus(key3, value3)
  }

  @Test
  fun removeItemsWorks() {
    val empty = ArrayMap.empty<String, String>()
    val arrayMap = empty.plus("first", "1").plus("second", "2").plus("third", "3")
    arrayMap.minusSortedIndices(listOf(2)) shouldBe mapOf("first" to "1", "second" to "2")
    arrayMap.minusSortedIndices(listOf(0)) shouldBe mapOf("second" to "2", "third" to "3")
    arrayMap.minusSortedIndices(listOf(1)) shouldBe mapOf("first" to "1", "third" to "3")

    arrayMap.minusSortedIndices(listOf(0, 2)) shouldBe mapOf("second" to "2")

    //    arrayMap.minusSortedIndices(listOf(1, 0))
    assertFails { arrayMap.minusSortedIndices(listOf(1, 0)) }.message shouldBe
        "The indices weren't sorted or were >= size=3: [1, 0]"
    assertFails { arrayMap.minusSortedIndices(listOf(2, 1)) }.message shouldBe
        "The indices weren't sorted or were >= size=3: [2, 1]"
    assertFails { arrayMap.minusSortedIndices(listOf(3)) }.message shouldBe
        "The indices weren't sorted or were >= size=3: [3]"
  }

  @Test
  fun wasBroken() {
    val map = ArrayMap.of(0.rangeTo(8).map { it to it.toString() }.toMutableList())
    map.minusSortedIndices(listOf(0, 2, 3, 6, 7, 8)).toString() shouldBe "{1=1, 4=4, 5=5}"
  }
}
