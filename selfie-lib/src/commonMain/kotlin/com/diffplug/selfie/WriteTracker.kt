/*
 * Copyright (C) 2023-2024 DiffPlug
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

expect class CallLocation : Comparable<CallLocation> {
  val file: String?
  val line: Int
  fun ideLink(layout: SnapshotFileLayout): String
}

expect fun recordCall(): CallStack

/** Represents the callstack above a given CallLocation. */
class CallStack(val location: CallLocation, val restOfStack: List<CallLocation>) {
  fun ideLink(layout: SnapshotFileLayout) =
      sequence {
            yield(location)
            yieldAll(restOfStack)
          }
          .joinToString("\n") { it.ideLink(layout) }
}

/** The first write at a given spot. */
internal class FirstWrite<T>(val snapshot: T, val callStack: CallStack)

/** For tracking the writes of disk snapshots literals. */
open class WriteTracker<K : Comparable<K>, V> {
  internal val writes = mutableMapOf<K, FirstWrite<V>>()
  protected fun recordInternal(key: K, snapshot: V, call: CallStack, layout: SnapshotFileLayout) {
    val existing = writes[key]
    if (existing == null) {
      writes[key] = FirstWrite(snapshot, call)
    } else {
      if (existing.snapshot != snapshot) {
        throw layout.fs.assertFailed(
            "Snapshot was set to multiple values!\n  first time: ${existing.callStack.location.ideLink(layout)}\n   this time: ${call.location.ideLink(layout)}",
            existing.snapshot,
            snapshot)
      } else if (TODO("RW.isWriteOnce")) {
        throw layout.fs.assertFailed(
            "Snapshot was set to the same value multiple times.",
            existing.callStack.ideLink(layout),
            call.ideLink(layout))
      }
    }
  }
}

class DiskWriteTracker : WriteTracker<String, Snapshot>() {
  fun record(key: String, snapshot: Snapshot, call: CallStack, layout: SnapshotFileLayout) {
    recordInternal(key, snapshot, call, layout)
  }
}

class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue<*>>() {
  fun record(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    recordInternal(call.location, literalValue, call, layout)
    // assert that the value passed at runtime matches the value we parse at compile time
    // because if that assert fails, we've got no business modifying test code
    val file =
        layout.sourcecodeForCall(call.location)
            ?: throw Error("Unable to find source file for ${call.location.ideLink(layout)}")
    if (literalValue.expected != null) {
      // if expected == null, it's a `toBe_TODO()`, so there's nothing to check
      val content = SourceFile(layout.fs.name(file), layout.fs.fileRead(file))
      val parsedValue = content.parseToBe(call.location.line).parseLiteral(literalValue.format)
      if (parsedValue != literalValue.expected) {
        throw layout.fs.assertFailed(
            "There is likely a bug in Selfie's literal parsing.",
            literalValue.expected,
            parsedValue)
      }
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
    var content = SourceFile(layout.fs.name(file), layout.fs.fileRead(file))
    var deltaLineNumbers = 0
    for (write in writes) {
      if (write.file != file) {
        layout.fs.fileWrite(file, content.asString)
        file = write.file
        deltaLineNumbers = 0
        content = SourceFile(layout.fs.name(file), layout.fs.fileRead(file))
      }
      // parse the location within the file
      val line = write.line + deltaLineNumbers
      if (write.literal.format == DiskSnapshotTodo) {
        content.replaceToMatchDisk_TODO(line)
      } else {
        val toBe =
            if (write.literal.expected == null) {
              content.parseToBe_TODO(line)
            } else {
              content.parseToBe(line)
            }
        deltaLineNumbers += toBe.setLiteralAndGetNewlineDelta(write.literal)
      }
    }
    layout.fs.fileWrite(file, content.asString)
  }
}
