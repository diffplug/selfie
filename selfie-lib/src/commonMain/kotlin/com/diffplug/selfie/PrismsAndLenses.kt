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
  fun transform(testClass: String, key: String, snapshot: Snapshot): SnapshotValue?
  override fun close() {}
}

/**
 * A prism transforms a single [Snapshot] into a new [Snapshot], transforming / creating / removing
 * [SnapshotValue]s along the way.
 */
@OptIn(ExperimentalStdlibApi::class)
interface SnapshotPrism : AutoCloseable {
  fun transform(className: String, key: String, snapshot: Snapshot): Snapshot
  override fun close() {}
}
fun interface SnapshotPredicate {
  fun test(testClass: String, key: String, snapshot: Snapshot): Boolean
}

/** A prism with a fluent API for creating [LensHoldingPrism]s gated by predicates. */
open class CompoundPrism : SnapshotPrism {
  private val prisms = mutableListOf<SnapshotPrism>()
  fun add(prism: SnapshotPrism): CompoundPrism {
    prisms.add(prism)
    return this
  }
  fun ifClassKeySnapshot(predicate: SnapshotPredicate): LensHoldingPrism {
    val prismWhere = LensHoldingPrism(predicate)
    add(prismWhere)
    return prismWhere
  }
  fun ifSnapshot(predicate: (Snapshot) -> Boolean) = ifClassKeySnapshot { _, _, snapshot ->
    predicate(snapshot)
  }
  fun forEverySnapshot(): LensHoldingPrism = ifSnapshot { true }
  fun ifString(predicate: (String) -> Boolean) = ifSnapshot {
    !it.value.isBinary && predicate(it.value.valueString())
  }
  fun ifStringIsProbablyHtml(): LensHoldingPrism {
    val regex = Regex("<\\/?[a-z][\\s\\S]*>")
    return ifString { regex.find(it) != null }
  }
  override fun transform(className: String, key: String, snapshot: Snapshot): Snapshot {
    var current = snapshot
    prisms.forEach { current = it.transform(className, key, current) }
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
          override fun transform(testClass: String, key: String, snapshot: Snapshot): Snapshot {
            val lensValue = lens.transform(testClass, key, snapshot)
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
  override fun transform(testClass: String, key: String, snapshot: Snapshot): Snapshot {
    if (!predicate.test(testClass, key, snapshot)) {
      return snapshot
    }
    var current = snapshot
    lenses.forEach { current = it.transform(testClass, key, snapshot) }
    return current
  }
  override fun close() {
    lenses.forEach(SnapshotPrism::close)
  }
}
