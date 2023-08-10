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

import kotlin.collections.binarySearch

expect abstract class ListBackedSet<T>() : Set<T>, AbstractList<T> {}

expect fun <K, V> entry(key: K, value: V): Map.Entry<K, V>

/** An immutable sorted map. */
interface FastMap<K : Comparable<K>, V : Any> : Map<K, V> {
  /**
   * Returns a new FastMap which has added the given key. Throws an exception if the key already
   * exists.
   */
  fun plus(key: K, value: V): FastMap<K, V>

  companion object {
    private val EMPTY = ArrayMap<String, Any>(arrayOf())

    fun <K : Comparable<K>, V : Any> empty() = EMPTY as FastMap<K, V>
  }
}

internal data class ArrayMap<K : Comparable<K>, V : Any>(private val data: Array<Any>) :
    FastMap<K, V> {
  private val dataAsKeys =
      object : ListBackedSet<K>() {
        override val size: Int
          get() = data.size / 2

        override fun get(index: Int): K {
          return data[index * 2] as K
        }
      }

  override fun plus(key: K, value: V): FastMap<K, V> {
    return when (size) {
      0 -> ArrayMap(arrayOf(key, value))
      1 ->
          key.compareTo(data[0] as K).let {
            if (it < 0) ArrayMap(arrayOf(key, value, data[0], data[1]))
            else if (it > 0) ArrayMap(arrayOf(data[0], data[1], key, value))
            else throw IllegalArgumentException("Key already exists: $key")
          }
      else -> TODO("Binary search like get()")
    }
  }

  override fun get(key: K): V? {
    val idx = dataAsKeys.binarySearch(key)
    return if (idx < 0) null else data[idx * 2 + 1] as V
  }

  override fun containsKey(key: K): Boolean = get(key) == null

  override fun containsValue(value: V): Boolean = values.contains(value)

  override val entries: Set<Map.Entry<K, V>>
    get() =
        object : ListBackedSet<Map.Entry<K, V>>() {
          override val size: Int
            get() = data.size / 2

          override fun get(index: Int): Map.Entry<K, V> {
            val key = data[index * 2] as K
            val value = data[index * 2 + 1] as V
            return entry(key, value)
          }
        }

  override val keys: Set<K>
    get() = dataAsKeys

  override val values: Collection<V>
    get() =
        object : AbstractList<V>() {
          override val size: Int
            get() = data.size / 2

          override fun get(index: Int): V = data[index * 2 + 1] as V
        }

  override val size: Int
    get() = data.size / 2

  override fun isEmpty(): Boolean = data.isEmpty()

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other == null || this::class != other::class) return false
    other as ArrayMap<*, *>
    return data.contentEquals(other.data)
  }

  override fun hashCode(): Int {
    return data.contentHashCode()
  }
}
