/*
 * Copyright (C) 2023-2026 DiffPlug
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
import com.diffplug.selfie.guts.WithinTestGC

/**
 * Searches the whole snapshot directory, finds all the `.ss` files, and prunes any which don't have
 * matching test files anymore.
 */
internal fun findStaleSnapshotFiles(layout: SnapshotFileLayoutJUnit5): List<String> {
  return layout.fs.fileWalk(layout.rootFolder) { walk ->
    walk
        .filter { it.name.endsWith(layout.extension) }
        .map { layout.subpathToClassname(layout.rootFolder.relativize(it)) }
        .filter { !classExistsAndHasTests(it, layout) }
        .toMutableList()
  }
}
private fun classExistsAndHasTests(key: String, layout: SnapshotFileLayoutJUnit5): Boolean {
  try {
    val clazz = Class.forName(key)
    val isTestClass = layout.resolvedTestSuperclasses.any { it.isAssignableFrom(clazz) }
    if (isTestClass) {
      return true
    }
    val hasTestAnnotations =
        generateSequence(clazz) { it.superclass }
            .flatMap { it.declaredMethods.asSequence() }
            .any { method -> layout.resolvedTestAnnotations.any { method.isAnnotationPresent(it) } }
    return hasTestAnnotations
  } catch (e: ClassNotFoundException) {
    // class doesn't exist, so it's definitely stale
    return false
  }
}
internal fun findTestMethodsThatDidntRun(
    className: String,
    testsThatRan: ArrayMap<String, WithinTestGC>,
    layout: SnapshotFileLayoutJUnit5,
): Sequence<String> =
    generateSequence(Class.forName(className)) { it.superclass }
        .flatMap { it.declaredMethods.asSequence() }
        .filter { method -> !testsThatRan.containsKey(method.name) }
        .filter { method -> layout.resolvedTestAnnotations.any { method.isAnnotationPresent(it) } }
        .map { it.name }
