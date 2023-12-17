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

import com.diffplug.selfie.RW
import com.diffplug.selfie.Snapshot
import java.nio.file.Files
import java.nio.file.Paths
import java.util.stream.Collectors
import kotlin.io.path.name

/** Represents the line at which user code called into Selfie. */
data class CallLocation(val clazz: String, val method: String, val file: String?, val line: Int) :
    Comparable<CallLocation> {
  override fun compareTo(other: CallLocation): Int =
      compareValuesBy(this, other, { it.clazz }, { it.method }, { it.file }, { it.line })

  /**
   * If the runtime didn't give us the filename, guess it from the class, and try to find the source
   * file by walking the CWD. If we don't find it, report it as a `.class` file.
   */
  private fun findFileIfAbsent(): String {
    if (file != null) {
      return file
    }
    val fileWithoutExtension = clazz.substringAfterLast('.').substringBefore('$')
    val likelyExtensions = listOf("kt", "java", "scala", "groovy", "clj", "cljc")
    val filenames = likelyExtensions.map { "$fileWithoutExtension.$it" }.toSet()
    val firstPath = Files.walk(Paths.get("")).use { it.filter { it.name in filenames }.findFirst() }
    return if (firstPath.isEmpty) "${clazz.substringAfterLast('.')}.class" else firstPath.get().name
  }

  /** A `toString` which an IDE will render as a clickable link. */
  override fun toString(): String = "$clazz.$method(${findFileIfAbsent()}:$line)"
}
/** Represents the callstack above a given CallLocation. */
class CallStack(val location: CallLocation, val restOfStack: List<CallLocation>) {
  override fun toString(): String {
    return location.toString()
  }
}
/** Generates a CallLocation and the CallStack behind it. */
fun recordCall(): CallStack {
  val calls =
      StackWalker.getInstance().walk { frames ->
        frames
            .dropWhile { it.className.startsWith("com.diffplug.selfie") }
            .map { CallLocation(it.className, it.methodName, it.fileName, it.lineNumber) }
            .collect(Collectors.toList())
      }
  return CallStack(calls.removeAt(0), calls)
}
/** The first write at a given spot. */
internal class FirstWrite<T>(val snapshot: T, val callStack: CallStack)

/** For tracking the writes of disk snapshots literals. */
internal open class WriteTracker<K : Comparable<K>, V> {
  val writes = mutableMapOf<K, FirstWrite<V>>()
  protected fun recordInternal(key: K, snapshot: V, call: CallStack) {
    val existing = writes.putIfAbsent(key, FirstWrite(snapshot, call))
    if (existing != null) {
      if (existing.snapshot != snapshot) {
        throw org.opentest4j.AssertionFailedError(
            "Snapshot was set to multiple values!\n  first time: ${existing.callStack}\n   this time: ${call}",
            existing.snapshot,
            snapshot)
      } else if (RW.isWriteOnce) {
        throw org.opentest4j.AssertionFailedError(
            "Snapshot was set to the same value multiple times.", existing.callStack, call)
      }
    }
  }
}

internal class DiskWriteTracker : WriteTracker<String, Snapshot>() {
  fun record(key: String, snapshot: Snapshot, call: CallStack) {
    recordInternal(key, snapshot, call)
  }
}

class LiteralValue {
  // TODO: String, Int, Long, Boolean, etc
}

internal class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue>() {
  fun record(call: CallStack, snapshot: LiteralValue) {
    recordInternal(call.location, snapshot, call)
  }
}
