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

/** Given a full [Snapshot], a lens returns either null or a single [SnapshotValue]. */
@OptIn(ExperimentalStdlibApi::class)
interface SnapshotLens : AutoCloseable {
  val defaultLensName: String
  fun transform(snapshot: Snapshot): SnapshotValue?
  override fun close() {}
}

/**
 * A prism transforms a single [Snapshot] into a new [Snapshot], transforming / creating / removing
 * [SnapshotValue]s along the way.
 */
@OptIn(ExperimentalStdlibApi::class)
interface SnapshotPrism : AutoCloseable {
  fun transform(snapshot: Snapshot): Snapshot
  override fun close() {}
}
fun interface SnapshotPredicate {
  fun test(snapshot: Snapshot): Boolean
}

/** A prism with a fluent API for creating [LensHoldingPrism]s gated by predicates. */
open class CompoundPrism : SnapshotPrism {
  private val prisms = mutableListOf<SnapshotPrism>()
  fun add(prism: SnapshotPrism) {
    prisms.add(prism)
  }
  fun forEveryString(transform: (String) -> String?) {
    add(
        object : ForEveryStringPrism() {
          override fun transform(snapshot: Snapshot, lensName: String, lensValue: String): String? {
            return transform(lensValue)
          }
        })
  }
  fun ifSnapshot(predicate: SnapshotPredicate): LensHoldingPrism {
    val prismWhere = LensHoldingPrism(predicate)
    add(prismWhere)
    return prismWhere
  }
  fun forEverySnapshot(): LensHoldingPrism = ifSnapshot { true }
  fun ifString(predicate: (String) -> Boolean) = ifSnapshot {
    !it.value.isBinary && predicate(it.value.valueString())
  }
  fun ifStringIsProbablyHtml(): LensHoldingPrism {
    val regex = Regex("<\\/?[a-z][\\s\\S]*>")
    return ifString { regex.find(it) != null }
  }
  override fun transform(snapshot: Snapshot): Snapshot {
    var current = snapshot
    prisms.forEach { current = it.transform(current) }
    return current
  }
  override fun close() = prisms.forEach(SnapshotPrism::close)
}

/** A prism which applies lenses to a snapshot. */
open class LensHoldingPrism(val predicate: SnapshotPredicate) : SnapshotPrism {
  private val lenses = mutableListOf<SnapshotPrism>()
  private fun addLensOrReplaceRoot(name: String?, lens: SnapshotLens): LensHoldingPrism {
    lenses.add(
        object : SnapshotPrism {
          override fun transform(snapshot: Snapshot): Snapshot {
            val lensValue = lens.transform(snapshot)
            return if (lensValue == null) snapshot
            else {
              if (name == null) snapshot.withNewRoot(lensValue) else snapshot.lens(name, lensValue)
            }
          }
          override fun close() = lens.close()
        })
    return this
  }
  fun addLens(name: String, lens: SnapshotLens): LensHoldingPrism = addLensOrReplaceRoot(name, lens)
  fun addLens(lens: SnapshotLens): LensHoldingPrism =
      addLensOrReplaceRoot(lens.defaultLensName, lens)
  fun replaceRootWith(lens: SnapshotLens): LensHoldingPrism = addLensOrReplaceRoot(null, lens)
  override fun transform(snapshot: Snapshot): Snapshot {
    if (!predicate.test(snapshot)) {
      return snapshot
    }
    var current = snapshot
    lenses.forEach { current = it.transform(snapshot) }
    return current
  }
  override fun close() {
    lenses.forEach(SnapshotPrism::close)
  }
}

abstract class ForEveryStringPrism : SnapshotPrism {
  protected abstract fun transform(snapshot: Snapshot, lensName: String, lensValue: String): String?
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
