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
package com.diffplug.selfie

/**
 * A lens transforms a single [Snapshot] into a new [Snapshot], transforming / creating / removing
 * [SnapshotValue]s along the way.
 */
fun interface SnapshotLens {
  fun transform(snapshot: Snapshot): Snapshot
}

/** A prism with a fluent API for creating [PrismHoldingLens]s gated by predicates. */
open class CompoundLens : SnapshotLens {
  private val lenses = mutableListOf<SnapshotLens>()
  fun add(lens: SnapshotLens) {
    lenses.add(lens)
  }
  fun replaceAll(toReplace: Regex, replacement: String) = mutateStrings {
    it.replace(toReplace, replacement)
  }
  fun mutateStrings(perString: (String) -> String?) {
    add { snapshot ->
      Snapshot.ofEntries(
          snapshot.allEntries().mapNotNull { e ->
            if (e.value.isBinary) e
            else perString(e.value.valueString())?.let { entry(e.key, SnapshotValue.of(it)) }
          })
    }
  }
  fun setFacetUsing(target: String, function: (Snapshot) -> String?) {
    add { snapshot -> setFacetOf(snapshot, target, function(snapshot)) }
  }
  fun setFacetUsingFacet(target: String, source: String, function: (String) -> String?) {
    add { snapshot ->
      val sourceValue = snapshot.subjectOrFacetMaybe(source)
      if (sourceValue == null) snapshot
      else setFacetOf(snapshot, target, function(sourceValue.valueString()))
    }
  }
  private fun setFacetOf(snapshot: Snapshot, target: String, newValue: String?): Snapshot =
      if (newValue == null) snapshot else snapshot.plusOrReplace(target, SnapshotValue.of(newValue))
  override fun transform(snapshot: Snapshot): Snapshot {
    var current = snapshot
    lenses.forEach { current = it.transform(current) }
    return current
  }
}
