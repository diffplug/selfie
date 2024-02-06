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

internal abstract class ArrayBackedLRUCache<K : Any, V>(private val capacity: Int) {
  private val cache: Array<Pair<K, V>?> = arrayOfNulls<Pair<K, V>?>(capacity)
  abstract fun keyEquality(a: K, b: K): Boolean
  private fun indexOf(key: K): Int {
    for (i in cache.indices) {
      if (cache[i]?.first?.let { keyEquality(it, key) } == true) {
        return i
      }
    }
    return -1
  }
  fun put(key: K, value: V) {
    val foundIndex = indexOf(key)
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
    val foundIndex = indexOf(key)
    return if (foundIndex == -1) null
    else {
      moveToFront(foundIndex)
      cache[0]!!.second
    }
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

class SourcePathCache(private val functionToCache: (CallLocation) -> TypedPath?, capacity: Int) {
  private val lock = reentrantLock()
  private val backingCache =
      object : ArrayBackedLRUCache<CallLocation, TypedPath>(capacity) {
        override fun keyEquality(a: CallLocation, b: CallLocation) = a.samePathAs(b)
      }
  fun get(key: CallLocation): TypedPath? {
    lock.withLock {
      backingCache.get(key)?.let {
        return it
      }
      val path = functionToCache(key)
      return if (path == null) null
      else {
        backingCache.put(key, path)
        path
      }
    }
  }
}
