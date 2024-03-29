/*
 * Copyright (C) 2024 DiffPlug
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
package com.diffplug.selfie.guts

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class ArrayBackedLRUCacheTest {
  @Test
  fun test() {
    val cache =
        object : ArrayBackedLRUCache<String, Int>(3) {
          override fun keyEquality(a: String, b: String) = a == b
        }
    cache.toString() shouldBe ""
    cache.put("a", 1)
    cache.toString() shouldBe "a=1"
    cache.put("b", 2)
    cache.toString() shouldBe "b=2 a=1"

    cache.get("a") shouldBe 1
    cache.toString() shouldBe "a=1 b=2"

    cache.put("b", 3)
    cache.toString() shouldBe "b=3 a=1"

    cache.put("c", 3)
    cache.toString() shouldBe "c=3 b=3 a=1"

    cache.put("d", 4)
    cache.toString() shouldBe "d=4 c=3 b=3"

    cache.get("a") shouldBe null
  }
}
