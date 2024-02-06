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

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.ArraySet
import com.diffplug.selfie.Snapshot

/** Handles garbage collection of snapshots within a single test. */
class WithinTestGC {
  private val suffixesToKeep: AtomicRef<ArraySet<String>?> = atomic(ArraySet.empty())
  fun keepSuffix(suffix: String) {
    suffixesToKeep.updateAndGet { it?.plusOrThis(suffix) }
  }
  fun keepAll(): WithinTestGC {
    suffixesToKeep.updateAndGet { null }
    return this
  }
  override fun toString() = suffixesToKeep.get()?.toString() ?: "(null)"
  fun succeededAndUsedNoSnapshots() = suffixesToKeep.get() === ArraySet.empty<String>()
  private fun keeps(s: String): Boolean = suffixesToKeep.get()?.contains(s) ?: true

  companion object {
    fun findStaleSnapshotsWithin(
        snapshots: ArrayMap<String, Snapshot>,
        testsThatRan: ArrayMap<String, WithinTestGC>,
        testsThatDidntRun: Sequence<String>
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
      var totalGc = testsThatRan
      for (method in testsThatDidntRun) {
        totalGc = totalGc.plus(method, WithinTestGC().keepAll())
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
  }
}
