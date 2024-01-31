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
package com.diffplug.selfie.junit5

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.ArraySet
import com.diffplug.selfie.Snapshot

/** Search for any test annotation classes which are present on the classpath. */
private val testAnnotations =
    listOf(
            "org.junit.jupiter.api.Test", // junit5,
            "org.junit.jupiter.params.ParameterizedTest",
            "org.junit.Test" // junit4
            )
        .mapNotNull {
          try {
            Class.forName(it).asSubclass(Annotation::class.java)
          } catch (e: ClassNotFoundException) {
            null
          }
        }

/**
 * Searches the whole snapshot directory, finds all the `.ss` files, and prunes any which don't have
 * matching test files anymore.
 */
internal fun findStaleSnapshotFiles(layout: SnapshotFileLayoutJUnit5): List<String> {
  return layout.fs.fileWalk(layout.rootFolder) { walk ->
    walk
        .filter { it.name.endsWith(layout.extension) }
        .map { layout.subpathToClassname(layout.rootFolder.relativize(it)) }
        .filter { !classExistsAndHasTests(it) }
        .toMutableList()
  }
}
private fun classExistsAndHasTests(key: String): Boolean {
  return try {
    generateSequence(Class.forName(key)) { it.superclass }
        .flatMap { it.declaredMethods.asSequence() }
        .any { method -> testAnnotations.any { method.isAnnotationPresent(it) } }
  } catch (e: ClassNotFoundException) {
    false
  }
}

internal class MethodSnapshotGC {
  private var suffixesToKeep: ArraySet<String>? = ArraySet.empty()
  fun keepSuffix(suffix: String) {
    suffixesToKeep = suffixesToKeep?.plusOrThis(suffix)
  }
  fun keepAll(): MethodSnapshotGC {
    suffixesToKeep = null
    return this
  }
  override fun toString() = java.util.Objects.toString(suffixesToKeep)
  private fun succeededAndUsedNoSnapshots() = ArraySet.empty<String>() == suffixesToKeep
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
          findTestMethodsThatDidntRun(className, methods).none()
    }
    private fun findTestMethodsThatDidntRun(
        className: String,
        methodsThatRan: ArrayMap<String, MethodSnapshotGC>,
    ): Sequence<String> =
        generateSequence(Class.forName(className)) { it.superclass }
            .flatMap { it.declaredMethods.asSequence() }
            .filter { method -> !methodsThatRan.containsKey(method.name) }
            .filter { method -> testAnnotations.any { method.isAnnotationPresent(it) } }
            .map { it.name }
  }
}
