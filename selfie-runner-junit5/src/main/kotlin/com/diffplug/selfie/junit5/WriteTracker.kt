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

import com.diffplug.selfie.LiteralValue
import com.diffplug.selfie.RW
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SourceFile
import java.nio.file.Files
import java.nio.file.Path
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
  private fun findFileIfAbsent(layout: SnapshotFileLayout): String {
    if (file != null) {
      return file
    }
    return layout.sourcecodeForCall(this)?.name ?: "${clazz.substringAfterLast('.')}.class"
  }

  /** A `toString` which an IDE will render as a clickable link. */
  fun ideLink(layout: SnapshotFileLayout): String {
    return "$clazz.$method(${findFileIfAbsent(layout)}:$line)"
  }
}
/** Represents the callstack above a given CallLocation. */
class CallStack(val location: CallLocation, val restOfStack: List<CallLocation>) {
  fun ideLink(layout: SnapshotFileLayout): String {
    val list = buildList {
      add(location)
      addAll(restOfStack)
    }
    return list.joinToString("\n") { it.ideLink(layout) }
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
  protected fun recordInternal(key: K, snapshot: V, call: CallStack, layout: SnapshotFileLayout) {
    val existing = writes.putIfAbsent(key, FirstWrite(snapshot, call))
    if (existing != null) {
      if (existing.snapshot != snapshot) {
        throw org.opentest4j.AssertionFailedError(
            "Snapshot was set to multiple values!\n  first time: ${existing.callStack.location.ideLink(layout)}\n   this time: ${call.location.ideLink(layout)}",
            existing.snapshot,
            snapshot)
      } else if (RW.isWriteOnce) {
        throw org.opentest4j.AssertionFailedError(
            "Snapshot was set to the same value multiple times.",
            existing.callStack.ideLink(layout),
            call.ideLink(layout))
      }
    }
  }
}

internal class DiskWriteTracker : WriteTracker<String, Snapshot>() {
  fun record(key: String, snapshot: Snapshot, call: CallStack, layout: SnapshotFileLayout) {
    recordInternal(key, snapshot, call, layout)
  }
}

internal class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue<*>>() {
  fun record(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    recordInternal(call.location, literalValue, call, layout)
    if (literalValue.expected != null) {
      throw UnsupportedOperationException(
          "`.toBe() didn't match! Change to `toBe_TODO()` to record a new value until https://github.com/diffplug/selfie/pull/49 is merged.")
    }
  }
  fun hasWrites(): Boolean = writes.isNotEmpty()

  private class FileLineLiteral(val file: Path, val line: Int, val literal: LiteralValue<*>) :
      Comparable<FileLineLiteral> {
    override fun compareTo(other: FileLineLiteral): Int =
        compareValuesBy(this, other, { it.file }, { it.line })
  }
  fun persistWrites(layout: SnapshotFileLayout) {
    if (this.writes.isEmpty()) {
      return
    }
    val writes =
        this.writes
            .toList()
            .map {
              FileLineLiteral(
                  layout.sourcecodeForCall(it.first)!!, it.first.line, it.second.snapshot)
            }
            .sorted()

    var file = writes.first().file
    var content = SourceFile(file.name, Files.readString(file))
    var deltaLineNumbers = 0
    for (write in writes) {
      if (write.file != file) {
        Files.writeString(file, content.asString)
        file = write.file
        deltaLineNumbers = 0
        content = SourceFile(file.name, Files.readString(file))
      }
      // parse the location within the file
      val line = write.line + deltaLineNumbers
      val toBe =
          if (write.literal.expected == null) {
            content.parseToBe_TODO(line)
          } else {
            content.parseToBe(line).also {
              val currentValue = it.parseLiteral(write.literal.format)
              if (currentValue != write.literal.expected) {
                // TODO: this shouldn't happen here, it should happen
                // when the write is recorded so that we can fail eagerly,
                // exceptions thrown here are easy to miss
                throw org.opentest4j.AssertionFailedError(
                    "There is likely a bug in Selfie's literal parsing.",
                    write.literal.expected,
                    currentValue)
              }
            }
          }
      deltaLineNumbers += toBe.setLiteralAndGetNewlineDelta(write.literal)
    }
    Files.writeString(file, content.asString)
  }
}
