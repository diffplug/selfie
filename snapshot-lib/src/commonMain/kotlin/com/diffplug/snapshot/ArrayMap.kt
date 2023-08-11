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

internal expect abstract class ListBackedSet<T>() : Set<T>, AbstractList<T> {}

internal expect fun <K, V> entry(key: K, value: V): Map.Entry<K, V>

/** An immutable, sorted, array-backed map. Wish it could be package-private! UGH!! */
class ArrayMap<K : Comparable<K>, V : Any>(private val data: Array<Any>) : Map<K, V> {
  /**
   * Returns a new FastMap which has added the given key. Throws an exception if the key already
   * exists.
   */
  fun plus(key: K, value: V): ArrayMap<K, V> {
    val idxExisting = dataAsKeys.binarySearch(key)
    if (idxExisting >= 0) {
      throw IllegalArgumentException("Key already exists: $key")
    }
    val idxInsert = -(idxExisting + 1)
    return when (data.size) {
      0 -> ArrayMap(arrayOf(key, value))
      1 -> {
        if (idxInsert == 0) ArrayMap(arrayOf(key, value, data[0], data[1]))
        else ArrayMap(arrayOf(data[0], data[1], key, value))
      }
      else ->
          // TODO: use idxInsert and arrayCopy to do this faster
          of(
              MutableList(size + 1) {
                if (it < size) Pair(data[it * 2] as K, data[it * 2 + 1] as V) else Pair(key, value)
              })
    }
  }
  /** list-backed set of guaranteed-sorted keys at even indices. */
  private val dataAsKeys =
      object : ListBackedSet<K>() {
        override val size: Int
          get() = data.size / 2
        override fun get(index: Int): K {
          return data[index * 2] as K
        }
      }
  override val keys: Set<K>
    get() = dataAsKeys
  override fun get(key: K): V? {
    val idx = dataAsKeys.binarySearch(key)
    return if (idx < 0) null else data[idx * 2 + 1] as V
  }
  override fun containsKey(key: K): Boolean = get(key) == null
  /** list-backed collection of values at odd indices. */
  override val values: List<V>
    get() =
        object : AbstractList<V>() {
          override val size: Int
            get() = data.size / 2
          override fun get(index: Int): V = data[index * 2 + 1] as V
        }
  override fun containsValue(value: V): Boolean = values.contains(value)
  /** list-backed set of entries. */
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
  override val size: Int
    get() = data.size / 2
  override fun isEmpty(): Boolean = data.isEmpty()
  override fun equals(other: Any?): Boolean {
    if (other === this) return true
    if (other !is Map<*, *>) return false
    if (size != other.size) return false
    if (other is ArrayMap<*, *>) {
      return data.contentEquals(other.data)
    } else {
      return other.entries.all { (key, value) -> this[key] == value }
    }
  }
  override fun hashCode(): Int = entries.hashCode()

  companion object {
    private val EMPTY = ArrayMap<String, Any>(arrayOf())
    fun <K : Comparable<K>, V : Any> empty() = EMPTY as ArrayMap<K, V>
    fun <K : Comparable<K>, V : Any> of(pairs: MutableList<Pair<K, V>>): ArrayMap<K, V> {
      val array = arrayOfNulls<Any>(pairs.size * 2)
      pairs.sortBy { it.first }
      for (i in 0 until pairs.size) {
        array[i * 2] = pairs[i].first
        array[i * 2 + 1] = pairs[i].second
      }
      return ArrayMap(array as Array<Any>)
    }
  }
}
