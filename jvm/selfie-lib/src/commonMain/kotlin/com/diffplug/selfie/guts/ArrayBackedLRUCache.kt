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

internal class ArrayBackedLRUCache<K : Any, V>(private val capacity: Int) {
  private val cache: Array<Pair<K, V>?> = arrayOfNulls<Pair<K, V>?>(capacity)
  fun put(key: K, value: V) {
    var foundIndex = -1
    for (i in cache.indices) {
      if (cache[i]?.first == key) {
        foundIndex = i
        break
      }
    }
    if (foundIndex != -1) {
      // key exists, update value and move to most recently used position
      moveToFront(foundIndex)
    } else {
      // move the last element to the front and overwrite it
      moveToFront(capacity - 1)
    }
    cache[0] = Pair(key, value)
  }
  fun get(key: K): V? {
    for (i in cache.indices) {
      if (cache[i]?.first == key) {
        val value = cache[i]!!.second
        moveToFront(i)
        return value
      }
    }
    return null
  }
  private fun moveToFront(index: Int) {
    if (index == 0) {
      return
    }
    val newFront = cache[index]
    for (i in index downTo 1) {
      cache[i] = cache[i - 1]
    }
    cache[0] = newFront
  }
  override fun toString() = cache.mapNotNull { it }.joinToString(" ") { (k, v) -> "$k=$v" }
}

abstract class LRUThreadSafeCache<K : Any, V>(capacity: Int) {
  private val backingCache = ArrayBackedLRUCache<K, V>(capacity)
  protected abstract fun compute(key: K): V
  private val lock = reentrantLock()
  fun get(key: K): V {
    lock.withLock {
      val value = backingCache.get(key)
      if (value != null) {
        return value
      }
      val newValue = compute(key)
      backingCache.put(key, newValue)
      return newValue
    }
  }
}
