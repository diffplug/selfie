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
package com.diffplug.selfie.junit5

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.ListBackedSet
import com.diffplug.selfie.Snapshot
import java.nio.file.Files
import kotlin.io.path.name
import org.junit.jupiter.api.Test

/**
 * Searches the whole snapshot directory, finds all the `.ss` files, and prunes any which don't have
 * matching test files anymore.
 */
internal fun findStaleSnapshotFiles(layout: SnapshotFileLayout): List<String> {
  val needsPruning = mutableListOf<String>()
  Files.walk(layout.rootFolder).use { paths ->
    paths
        .filter { it.name.endsWith(layout.extension) && Files.isRegularFile(it) }
        .map { layout.subpathToClassname(layout.rootFolder.relativize(it).toString()) }
        .filter(::classExistsAndHasTests)
        .forEach(needsPruning::add)
  }
  return needsPruning
}
private fun classExistsAndHasTests(key: String): Boolean {
  try {
    return Class.forName(key).declaredMethods.any { it.isAnnotationPresent(Test::class.java) }
  } catch (e: ClassNotFoundException) {
    return false
  }
}

internal class MethodSnapshotGC {
  private var suffixesToKeep: ArraySet<String>? = EMPTY_SET
  fun keepSuffix(suffix: String) {
    suffixesToKeep?.let { it.plusOrThis(suffix) }
  }
  fun keepAll() {
    suffixesToKeep = null
  }
  fun succeeded(success: Boolean) {
    if (!success) keepAll() // if a method fails we have to keep all its snapshots just in case
  }
  private fun succeededAndUsedNoSnapshots() = suffixesToKeep == EMPTY_SET

  companion object {
    fun findStaleSnapshotsWithin(
        className: String,
        snapshots: ArrayMap<String, Snapshot>,
        methods: ArrayMap<String, MethodSnapshotGC>,
        classLevelSuccess: Boolean
    ): List<String> {
      // TODO: implement
      // - Every snapshot is named `testMethod` or `testMethod/subpath`
      // - It is possible to have `testMethod/subpath` without `testMethod`
      // - If a snapshot does not have a corresponding testMethod, it is stale
      // - If a method ran successfully, then we should keep exclusively the snapshots in
      // MethodSnapshotUsage#suffixesToKeep
      // - Unless that method has `keepAll`, in which case the user asked to exclude that method
      // from pruning
      val testMethods = findTestMethods(className)
      return listOf()
    }

    /**
     * This method is called only when a class has completed without ever touching a snapshot file.
     */
    fun isUnusedSnapshotFileStale(
        className: String,
        methods: ArrayMap<String, MethodSnapshotGC>,
        classLevelSuccess: Boolean
    ): Boolean {
      if (!classLevelSuccess) {
        // if the class failed, then we can't know that it wouldn't have used snapshots if it
        // succeeded
        return false
      }
      if (!methods.keys.containsExactSameElementsAs(findTestMethods(className))) {
        // if some methods didn't run, then we can't know for sure that we don't need their
        // snapshots
        return false
      }
      // if all methods ran successfully, then we can delete the snapshot file since it wasn't used
      return methods.values.all { it.succeededAndUsedNoSnapshots() }
    }
    private fun findTestMethods(className: String): List<String> {
      val clazz = Class.forName(className)
      return clazz.declaredMethods
          .filter { it.isAnnotationPresent(Test::class.java) }
          .map { it.name }
    }
    private val EMPTY_SET = ArraySet<String>(arrayOf())
  }
}
private fun <T : Comparable<T>> ListBackedSet<T>.containsExactSameElementsAs(
    other: List<T>
): Boolean {
  if (size != other.size) return false
  val sorted = other.sorted()
  for (i in 0 until size) {
    if (this[i] != sorted[i]) return false
  }
  return true
}

/** An immutable, sorted, array-backed set. Wish it could be package-private! UGH!! */
internal class ArraySet<K : Comparable<K>>(private val data: Array<Any>) : ListBackedSet<K>() {
  override val size: Int
    get() = data.size
  override fun get(index: Int): K = data[index] as K
  fun plusOrThis(key: K): ArraySet<K> {
    val idxExisting = data.binarySearch(key)
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
        array.sort()
        ArraySet(array)
      }
    }
  }
}
