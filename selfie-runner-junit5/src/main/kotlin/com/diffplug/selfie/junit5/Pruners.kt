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
import com.diffplug.selfie.Snapshot
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name

internal object SnapshotFilePruner {
  fun needsPruning(root: Path, subpathToClassname: (String) -> String): List<String> {
    val needsPruning = mutableListOf<String>()
    Files.walk(root).use { paths ->
      paths
          .filter { it.name.endsWith(".ss") && Files.isRegularFile(it) }
          .map { subpathToClassname(root.relativize(it).toString()) }
          .filter(::classExists)
          .forEach(needsPruning::add)
    }
    return needsPruning
  }
  private fun classExists(key: String): Boolean {
    try {
      Class.forName(key)
      return true
    } catch (e: ClassNotFoundException) {
      return false
    }
  }
}

internal class SnapshotMethodPruner {
  private val toKeep = mutableSetOf<String>()
  fun keep(key: String) {
    toKeep.add(key)
  }

  var keepAll = false
  fun keepAll() {
    keepAll = true
  }

  var succeeded = false
  fun succeeded() {
    succeeded = true
  }

  companion object {
    fun findStaleSnapshotsWithin(
        className: String,
        snapshots: ArrayMap<String, Snapshot>,
        methods: ArrayMap<String, SnapshotMethodPruner>,
        classLevelSuccess: Boolean
    ): List<String> {
      // TODO: implement
      // - Every snapshot is named `testMethod` or `testMethod/subpath`
      // - It is possible to have `testMethod/subpath` without `testMethod`
      // - If a snapshot does not have a corresponding testMethod, it is stale
      // - If a method ran successfully, then we should keep exclusively the snapshots in
      // SnapshotMethodPruner#toKeep
      // - Unless that method has `keepAll`, in which case the user asked to exclude that method
      // from pruning
      val testMethods = findTestMethodsSorted(className)
      return listOf()
    }

    /**
     * This method is called only when a class has completed without ever touching a snapshot file.
     */
    fun isUnusedSnapshotFileStale(
        className: String,
        methods: ArrayMap<String, SnapshotMethodPruner>,
        classLevelSuccess: Boolean
    ): Boolean {
      if (!classLevelSuccess) {
        // if the class failed, then we can't know that it wouldn't have used snapshots if it
        // succeeded
        return false
      }
      val testMethods = findTestMethodsSorted(className)
      if (!methods.keys.isEqualToPresortedList(testMethods)) {
        // if some methods didn't run, then we can't know for sure that we don't need their
        // snapshots
        return false
      }
      // if all methods ran successfully, then we can delete the snapshot file since it wasn't used
      return methods.values.all { it.succeeded }
    }
    private fun findTestMethodsSorted(className: String): List<String> {
      val clazz = Class.forName(className)
      return clazz.declaredMethods
          .filter { it.isAnnotationPresent(org.junit.jupiter.api.Test::class.java) }
          .map { it.name }
          .sorted()
    }
  }
}
