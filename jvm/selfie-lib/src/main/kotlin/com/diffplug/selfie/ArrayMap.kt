/*
 * Copyright (C) 2023-2024 DiffPlug
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

import kotlin.collections.binarySearch
private val STRING_SLASHFIRST =
    Comparator<String> { a, b ->
      var i = 0
      while (i < a.length && i < b.length) {
        val charA = a[i]
        val charB = b[i]
        if (charA != charB) {
          return@Comparator ( // treat
          if (charA == '/') -1 // slash as
          else if (charB == '/') 1 // the lowest
          else charA.compareTo(charB) // character
          )
        }
        i++
      }
      a.length.compareTo(b.length)
    }
private val PAIR_STRING_SLASHFIRST =
    Comparator<Pair<String, Any>> { a, b -> STRING_SLASHFIRST.compare(a.first, b.first) }

abstract class ListBackedSet<T>() : AbstractSet<T>() {
  abstract operator fun get(index: Int): T
  override fun iterator(): Iterator<T> =
      object : Iterator<T> {
        private var index = 0
        override fun hasNext(): Boolean = index < size
        override fun next(): T {
          if (!hasNext()) throw NoSuchElementException()
          return get(index++)
        }
      }
}
private fun <T : Comparable<T>> ListBackedSet<T>.binarySearch(element: T): Int {
  val list =
      object : AbstractList<T>() {
        override val size: Int
          get() = this@binarySearch.size
        override fun get(index: Int): T = this@binarySearch[index]
      }
  return if (element is String) {
    (list as List<String>).binarySearch(element, STRING_SLASHFIRST)
  } else list.binarySearch(element)
}

internal expect fun <K, V> entry(key: K, value: V): Map.Entry<K, V>

/**
 * An immutable, sorted, array-backed map - if keys are [String], they have a special sort order
 * where `/` is the lowest key.
 */
class ArrayMap<K : Comparable<K>, V : Any>(private val data: Array<Any>) : Map<K, V> {
  fun minusSortedIndices(indicesToRemove: List<Int>): ArrayMap<K, V> {
    if (indicesToRemove.isEmpty()) {
      return this
    }
    val newData = arrayOfNulls<Any>(data.size - indicesToRemove.size * 2)
    var newDataIdx = 0
    var currentPairIdx = 0 // Index for key-value pairs
    var toRemoveIdx = 0
    while (currentPairIdx < data.size / 2) {
      if (toRemoveIdx < indicesToRemove.size && currentPairIdx == indicesToRemove[toRemoveIdx]) {
        toRemoveIdx++
      } else {
        check(newDataIdx < newData.size) {
          "The indices weren't sorted or were >= size=$size: $indicesToRemove"
        }
        newData[newDataIdx++] = data[2 * currentPairIdx] // Copy key
        newData[newDataIdx++] = data[2 * currentPairIdx + 1] // Copy value
      }
      currentPairIdx++
    }

    // Ensure all indices to remove have been processed
    check(toRemoveIdx == indicesToRemove.size) {
      "The indices weren't sorted or were >= size($size): $indicesToRemove"
    }
    return ArrayMap<K, V>(newData as Array<Any>)
  }

  /**
   * Returns a new ArrayMap which has added the given key. Throws an exception if the key already
   * exists.
   */
  fun plus(key: K, value: V): ArrayMap<K, V> {
    val next = plusOrNoOp(key, value)
    if (next === this) {
      throw IllegalArgumentException("Key already exists: $key")
    }
    return next
  }
  /**
   * Returns a new ArrayMap which has added the given key, or the current map if the key was already
   * in the map.
   */
  fun plusOrNoOp(key: K, value: V): ArrayMap<K, V> {
    val idxExisting = dataAsKeys.binarySearch(key)
    return if (idxExisting >= 0) this
    else {
      val idxInsert = -(idxExisting + 1)
      insert(idxInsert, key, value)
    }
  }
  /**
   * Returns an ArrayMap which has added or overwritten the given key/value. If the map already
   * contained that mapping (equal keys and values) then it returns the identically same map.
   */
  fun plusOrNoOpOrReplace(key: K, newValue: V): ArrayMap<K, V> {
    val idxExisting = dataAsKeys.binarySearch(key)
    if (idxExisting >= 0) {
      val existingValue = data[idxExisting * 2 + 1] as V
      return if (newValue == existingValue) this
      else {
        val copy = data.copyOf()
        copy[idxExisting * 2 + 1] = newValue
        return ArrayMap(copy)
      }
    } else {
      val idxInsert = -(idxExisting + 1)
      return insert(idxInsert, key, newValue)
    }
  }
  private fun insert(idxInsert: Int, key: K, value: V): ArrayMap<K, V> {
    return when (data.size) {
      0 -> ArrayMap(arrayOf(key, value))
      1 -> {
        if (idxInsert == 0) ArrayMap(arrayOf(key, value, data[0], data[1]))
        else ArrayMap(arrayOf(data[0], data[1], key, value))
      }
      else ->
          // TODO: use idxInsert and arrayCopy to do this faster, see ArraySet#plusOrThis
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
  override val keys: ListBackedSet<K>
    get() = dataAsKeys
  override fun get(key: K): V? {
    val idx = dataAsKeys.binarySearch(key)
    return if (idx < 0) null else data[idx * 2 + 1] as V
  }
  override fun containsKey(key: K): Boolean = dataAsKeys.binarySearch(key) >= 0
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
  override val entries: ListBackedSet<Map.Entry<K, V>>
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
    return if (other is ArrayMap<*, *>) {
      data.contentEquals(other.data)
    } else {
      other.entries.all { (key, value) -> this[key] == value }
    }
  }
  override fun hashCode(): Int = entries.hashCode()
  override fun toString() = this.toMutableMap().toString()

  companion object {
    private val EMPTY = ArrayMap<String, Any>(arrayOf())
    fun <K : Comparable<K>, V : Any> empty() = EMPTY as ArrayMap<K, V>
    fun <K : Comparable<K>, V : Any> of(pairs: MutableList<Pair<K, V>>): ArrayMap<K, V> {
      if (pairs.size > 1) {
        if (pairs[0].first is String) {
          (pairs as (MutableList<Pair<String, Any>>)).sortWith(PAIR_STRING_SLASHFIRST)
        } else {
          pairs.sortBy { it.first }
        }
      }
      val array = arrayOfNulls<Any>(pairs.size * 2)
      for (i in 0 until pairs.size) {
        array[i * 2] = pairs[i].first
        array[i * 2 + 1] = pairs[i].second
      }
      return ArrayMap(array as Array<Any>)
    }
  }
}

/**
 * An immutable, sorted, array-backed set - if keys are [String], they have a special sort order
 * where `/` is the lowest key.
 */
class ArraySet<K : Comparable<K>>(private val data: Array<Any>) : ListBackedSet<K>() {
  override val size: Int
    get() = data.size
  override fun get(index: Int): K = data[index] as K
  override fun contains(element: K): Boolean = binarySearch(element) >= 0
  fun plusOrThis(key: K): ArraySet<K> {
    val idxExisting = binarySearch(key)
    if (idxExisting >= 0) {
      return this
    }
    val idxInsert = -(idxExisting + 1)
    return when (data.size) {
      0 -> ArraySet(arrayOf(key))
      1 -> {
        if (idxInsert == 0)
            ArraySet(
                arrayOf(
                    key,
                    data[0],
                ))
        else ArraySet(arrayOf(data[0], key))
      }
      else -> {
        // TODO: use idxInsert and arrayCopy to do this faster, see ArrayMap#insert
        val array = Array(size + 1) { if (it < size) data[it] else key }
        if (key is String) {
          array.sortWith(STRING_SLASHFIRST as Comparator<Any>)
        } else {
          (array as Array<K>).sort()
        }
        ArraySet(array)
      }
    }
  }

  companion object {
    private val EMPTY = ArraySet<String>(arrayOf())
    fun <K : Comparable<K>> empty() = EMPTY as ArraySet<K>
  }
}
