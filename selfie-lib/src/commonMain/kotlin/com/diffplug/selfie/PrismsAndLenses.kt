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

/** Given a full [Snapshot], a prism returns either null or a single [SnapshotValue]. */
@OptIn(ExperimentalStdlibApi::class)
fun interface SnapshotPrism : AutoCloseable {
  fun transform(snapshot: Snapshot): SnapshotValue?
  override fun close() {}
}

/**
 * A lens transforms a single [Snapshot] into a new [Snapshot], transforming / creating / removing
 * [SnapshotValue]s along the way.
 */
@OptIn(ExperimentalStdlibApi::class)
fun interface SnapshotLens : AutoCloseable {
  fun transform(snapshot: Snapshot): Snapshot
  override fun close() {}
}
fun interface SnapshotPredicate {
  fun test(snapshot: Snapshot): Boolean
}

/** A prism with a fluent API for creating [PrismHoldingLens]s gated by predicates. */
open class CompoundLens : SnapshotLens {
  private val prisms = mutableListOf<SnapshotLens>()
  fun add(prism: SnapshotLens) {
    prisms.add(prism)
  }
  fun forEveryString(transform: (String) -> String?) {
    add(
        object : ForEveryStringLens {
          override fun transform(snapshot: Snapshot, lensName: String, lensValue: String): String? {
            return transform(lensValue)
          }
        })
  }
  fun ifSnapshot(predicate: SnapshotPredicate): PrismHoldingLens {
    val prismWhere = PrismHoldingLens(predicate)
    add(prismWhere)
    return prismWhere
  }
  fun forEverySnapshot(): PrismHoldingLens = ifSnapshot { true }
  fun ifString(predicate: (String) -> Boolean) = ifSnapshot {
    !it.subject.isBinary && predicate(it.subject.valueString())
  }
  fun ifStringIsProbablyHtml(): PrismHoldingLens {
    val regex = Regex("<\\/?[a-z][\\s\\S]*>")
    return ifString { regex.find(it) != null }
  }
  override fun transform(snapshot: Snapshot): Snapshot {
    var current = snapshot
    prisms.forEach { current = it.transform(current) }
    return current
  }
  override fun close() = prisms.forEach(SnapshotLens::close)
}

/** A prism which applies lenses to a snapshot. */
open class PrismHoldingLens(val predicate: SnapshotPredicate) : SnapshotLens {
  private val lenses = mutableListOf<SnapshotLens>()
  private fun addLensOrReplaceRoot(name: String?, lens: SnapshotPrism): PrismHoldingLens {
    lenses.add(
        object : SnapshotLens {
          override fun transform(snapshot: Snapshot): Snapshot {
            val lensValue = lens.transform(snapshot)
            return if (lensValue == null) snapshot
            else {
              if (name == null) snapshot.withNewSubject(lensValue)
              else snapshot.plusFacet(name, lensValue)
            }
          }
          override fun close() = lens.close()
        })
    return this
  }
  fun addLens(name: String, lens: SnapshotPrism): PrismHoldingLens =
      addLensOrReplaceRoot(name, lens)
  fun replaceRootWith(lens: SnapshotPrism): PrismHoldingLens = addLensOrReplaceRoot(null, lens)
  override fun transform(snapshot: Snapshot): Snapshot {
    if (!predicate.test(snapshot)) {
      return snapshot
    }
    var current = snapshot
    lenses.forEach { current = it.transform(snapshot) }
    return current
  }
  override fun close() {
    lenses.forEach(SnapshotLens::close)
  }
}
fun interface ForEveryStringLens : SnapshotLens {
  fun transform(snapshot: Snapshot, facetName: String, facetValue: String): String?
  override fun transform(snapshot: Snapshot) =
      Snapshot.ofEntries(
          snapshot.allEntries().mapNotNull {
            if (it.value.isBinary) it
            else {
              val newValue = transform(snapshot, it.key, it.value.valueString())
              newValue?.let { newValue -> entry(it.key, SnapshotValue.of(newValue)) } ?: null
            }
          })
}

object Lenses {
  fun forEveryString(transform: (String) -> String?) =
      object : ForEveryStringLens {
        override fun transform(snapshot: Snapshot, facetName: String, facetValue: String): String? {
          return transform(facetValue)
        }
      }
}
