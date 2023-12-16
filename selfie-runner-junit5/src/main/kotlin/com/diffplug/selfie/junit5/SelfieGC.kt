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
        .map {
          layout.subpathToClassname(layout.rootFolder.relativize(it).toString().replace('\\', '/'))
        }
        .filter { !classExistsAndHasTests(it) }
        .forEach(needsPruning::add)
  }
  return needsPruning
}
private fun classExistsAndHasTests(key: String): Boolean {
  return try {
    Class.forName(key).methods.any { it.annotations.any { it.annotationClass.simpleName == "Test" } }
  } catch (e: ClassNotFoundException) {
    false
  }
}

internal class MethodSnapshotGC {
  private var suffixesToKeep: ArraySet<String>? = EMPTY_SET
  fun keepSuffix(suffix: String) {
    suffixesToKeep = suffixesToKeep?.plusOrThis(suffix)
  }
  fun keepAll(): MethodSnapshotGC {
    suffixesToKeep = null
    return this
  }
  fun succeeded(success: Boolean) {
    if (!success) keepAll() // if a method fails we have to keep all its snapshots just in case
  }
  override fun toString() = java.util.Objects.toString(suffixesToKeep)
  private fun succeededAndUsedNoSnapshots() = suffixesToKeep == EMPTY_SET
  private fun keeps(s: String): Boolean = suffixesToKeep?.contains(s) ?: true

  companion object {
    fun findStaleSnapshotsWithin(
        className: String,
        snapshots: ArrayMap<String, Snapshot>,
        methods: ArrayMap<String, MethodSnapshotGC>,
    ): List<Int> {
      val staleIndices = mutableListOf<Int>()

      // - Every snapshot is named `testMethod` or `testMethod/subpath`
      // - It is possible to have `testMethod/subpath` without `testMethod`
      // - If a snapshot does not have a corresponding testMethod, it is stale
      // - If a method ran successfully, then we should keep exclusively the snapshots in
      // MethodSnapshotUsage#suffixesToKeep
      // - Unless that method has `keepAll`, in which case the user asked to exclude that method
      // from pruning

      // combine what we know about methods that did run with what we know about the tests that
      // didn't
      var totalGc = methods
      for (method in findTestMethodsThatDidntRun(className, methods)) {
        totalGc = totalGc.plus(method, MethodSnapshotGC().keepAll())
      }
      val gcRoots = totalGc.entries
      val keys = snapshots.keys
      // we'll start with the lowest gc, and the lowest key
      var gcIdx = 0
      var keyIdx = 0
      while (keyIdx < keys.size && gcIdx < gcRoots.size) {
        val key = keys[keyIdx]
        val gc = gcRoots[gcIdx]
        if (key.startsWith(gc.key)) {
          if (key.length == gc.key.length) {
            // startWith + same length = exact match, no suffix
            if (!gc.value.keeps("")) {
              staleIndices.add(keyIdx)
            }
            ++keyIdx
            continue
          } else if (key.elementAt(gc.key.length) == '/') {
            // startWith + not same length = can safely query the `/`
            val suffix = key.substring(gc.key.length)
            if (!gc.value.keeps(suffix)) {
              staleIndices.add(keyIdx)
            }
            ++keyIdx
            continue
          } else {
            // key is longer than gc.key, but doesn't start with gc.key, so we must increment gc
            ++gcIdx
            continue
          }
        } else {
          // we don't start with the key, so we must increment
          if (gc.key < key) {
            ++gcIdx
          } else {
            // we never found a gc that started with this key, so it's stale
            staleIndices.add(keyIdx)
            ++keyIdx
          }
        }
      }
      while (keyIdx < keys.size) {
        staleIndices.add(keyIdx)
        ++keyIdx
      }
      return staleIndices
    }

    /**
     * This method is called only when a class has completed without ever touching a snapshot file.
     */
    fun isUnusedSnapshotFileStale(
        className: String,
        methods: ArrayMap<String, MethodSnapshotGC>,
        classLevelSuccess: Boolean
    ): Boolean {
      // we need the entire class to succeed in order to be sure
      return classLevelSuccess &&
          // we need every method to succeed and not use any snapshots
          methods.values.all { it.succeededAndUsedNoSnapshots() } &&
          // we need every method to run
          findTestMethodsThatDidntRun(className, methods).isEmpty()
    }
    private fun findTestMethodsThatDidntRun(
        className: String,
        methodsThatRan: ArrayMap<String, MethodSnapshotGC>,
    ): List<String> {
      return Class.forName(className).declaredMethods.mapNotNull {
        if (methodsThatRan.containsKey(it.name) || !it.isAnnotationPresent(Test::class.java)) {
          null
        } else {
          it.name
        }
      }
    }
    private val EMPTY_SET = ArraySet<String>(arrayOf())
  }
}

/** An immutable, sorted, array-backed set. */
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
