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
    return findAllSnapshotFiles(root, subpathToClassname).filter { !classExists(it) }
  }
  private fun findAllSnapshotFiles(
      root: Path,
      subpathToClassname: (String) -> String
  ): List<String> =
      Files.walk(root).use { paths ->
        paths
            .filter { it.name.endsWith(".ss") && Files.isRegularFile(it) }
            .map { subpathToClassname(root.relativize(it).toString()) }
            .toList()
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

  var isExhaustive = false
  fun succeeded() {
    isExhaustive = true
  }

  companion object {
    fun prune(
        className: String,
        snapshots: ArrayMap<String, Snapshot>,
        methods: ArrayMap<String, SnapshotMethodPruner>,
        total: Boolean
    ) {}
  }
}
