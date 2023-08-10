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

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import kotlin.test.Ignore
import kotlin.test.Test

class FastMapTest {
  private fun assertEmpty(map: FastMap<String, String>) {
    map.size shouldBe 0
    map.keys shouldBe emptySet()
    map.values shouldBe emptyList()
    map.entries shouldBe emptySet()
    map["key"] shouldBe null
    map shouldBe mapOf()
    map shouldBe FastMap.empty()
  }

  private fun assertSingle(map: FastMap<String, String>, key: String, value: String) {
    map.size shouldBe 1
    map.keys shouldBe setOf(key)
    map.values shouldBe listOf(value)
    map.entries shouldBe setOf(entry(key, value))
    map[key] shouldBe value
    map[key + "blah"] shouldBe null
    map shouldBe mapOf(key to value)
    map shouldBe FastMap.empty<String, String>().plus(key, value)
  }

  private fun assertDouble(
      map: FastMap<String, String>,
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
    map shouldBe FastMap.empty<String, String>().plus(key1, value1).plus(key2, value2)
    map shouldBe FastMap.empty<String, String>().plus(key2, value2).plus(key1, value1)
  }

  @Test
  fun empty() {
    val empty = FastMap.empty<String, String>()
    assertEmpty(empty)
  }

  @Test
  fun single() {
    val empty = FastMap.empty<String, String>()
    val single = empty.plus("one", "1")
    assertEmpty(empty)
    assertSingle(single, "one", "1")
  }

  @Test
  fun double() {
    val empty = FastMap.empty<String, String>()
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
  @Ignore // TODO: implement
  fun multi() {
    val three = FastMap.empty<String, String>().plus("1", "one").plus("2", "two").plus("3", "three")
    three.size shouldBe 3
  }
}
