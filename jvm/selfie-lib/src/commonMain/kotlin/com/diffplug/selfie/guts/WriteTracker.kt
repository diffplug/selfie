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
package com.diffplug.selfie.guts

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.Snapshot

expect class CallLocation : Comparable<CallLocation> {
  val fileName: String?
  val line: Int
  /** Returns a new CallLocation at the given line. */
  fun withLine(line: Int): CallLocation
  /** Returns a string which an IDE can render as a hyperlink. */
  fun ideLink(layout: SnapshotFileLayout): String
  /**
   * Computing the exact path using [SnapshotFileLayout.sourcePathForCall] is expensive, so it can
   * be helpful to cache these.
   *
   * If this method always returns false, that would be okay but slow. False negatives are okay,
   * false positives will result in incorrect behavior.
   */
  fun samePathAs(other: CallLocation): Boolean

  /** Returns the likely name of the sourcecode of this file, without path or extension. */
  fun sourceFilenameWithoutExtension(): String
  override fun compareTo(other: CallLocation): Int
}

internal expect fun recordCall(callerFileOnly: Boolean): CallStack

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
sealed class WriteTracker<K : Comparable<K>, V> {
  internal val writes = atomic(ArrayMap.empty<K, FirstWrite<V>>())
  protected fun recordInternal(key: K, snapshot: V, call: CallStack, layout: SnapshotFileLayout) {
    val thisWrite = FirstWrite(snapshot, call)
    val possiblyUnchangedMap = writes.updateAndGet { it.plusOrNoOp(key, thisWrite) }
    val existing = possiblyUnchangedMap[key]!!
    if (existing === thisWrite) {
      // we were the first write
      return
    }
    // we were not the first write
    layout.checkForSmuggledError()
    val howToFix =
        when (this) {
          is DiskWriteTracker ->
              "You can fix this with `.toMatchDisk(String sub)` and pass a unique value for sub."
          is InlineWriteTracker ->
              """
          You can fix this by doing an `if` before the assertion to separate the cases, e.g.
            if (isWindows) {
              expectSelfie(underTest).toBe("C:\\")
            } else {
              expectSelfie(underTest).toBe("bash$")
            }
        """
          is ToBeFileWriteTracker ->
              "You can fix this with `.toBeFile(String filename)` and pass a unique filename for each code path."
        }
    if (existing.snapshot != snapshot) {
      throw layout.fs.assertFailed(
          "Snapshot was set to multiple values!\n" +
              "  first value: ${existing.snapshot}\n" +
              "    this time: ${snapshot}\n" +
              "   first call: ${existing.callStack.ideLink(layout)}\n" +
              "    this call: ${call.ideLink(layout)}\n" +
              "$howToFix",
          existing.snapshot,
          snapshot)
    } else if (!layout.allowMultipleEquivalentWritesToOneLocation) {
      throw layout.fs.assertFailed(
          "Snapshot was set to the same value multiple times.\n$howToFix",
          existing.callStack.ideLink(layout),
          call.ideLink(layout))
    }
  }
}

class DiskWriteTracker : WriteTracker<String, Snapshot>() {
  fun record(key: String, snapshot: Snapshot, call: CallStack, layout: SnapshotFileLayout) {
    recordInternal(key, snapshot, call, layout)
  }
}

class ToBeFileWriteTracker : WriteTracker<TypedPath, ToBeFileLazyBytes>() {
  fun writeToDisk(
      key: TypedPath,
      snapshot: ByteArray,
      call: CallStack,
      layout: SnapshotFileLayout
  ) {
    val lazyBytes = ToBeFileLazyBytes(key, layout, snapshot)
    recordInternal(key, lazyBytes, call, layout)
    // recordInternal will throw an exception on a duplicate write, so we can safely write to disk
    lazyBytes.writeToDisk()
    // and because we are doing duplicate checks, `ToBeFileLazyBytes` can allow its in-memory
    // data to be garbage collected, because it can safely read from disk in the future
  }
}

class ToBeFileLazyBytes(val location: TypedPath, val layout: SnapshotFileLayout, data: ByteArray) {
  /** When constructed, we always have the data. */
  var data: ByteArray? = data
  /**
   * Shortly after being construted, this data is written to disk, and we can stop holding it in
   * memory.
   */
  internal fun writeToDisk() {
    data?.let { layout.fs.fileWriteBinary(location, it) }
        ?: throw IllegalStateException("Data has already been written to disk!")
    data = null
  }
  /**
   * If we need to read our data, we do it from memory if it's still there, or from disk if it
   * isn't.
   */
  private fun readData(): ByteArray = data ?: layout.fs.fileReadBinary(location)
  /** We calculate equality based on this data. */
  override fun equals(other: Any?): Boolean =
      if (this === other) true
      else if (other is ToBeFileLazyBytes) readData().contentEquals(other.readData()) else false
  override fun hashCode(): Int = readData().contentHashCode()
}

class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue<*>>() {
  fun record(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    recordInternal(call.location, literalValue, call, layout)
    // assert that the value passed at runtime matches the value we parse at compile time
    // because if that assert fails, we've got no business modifying test code
    val file = layout.sourcePathForCall(call.location)
    if (literalValue.expected != null) {
      // if expected == null, it's a `toBe_TODO()`, so there's nothing to check
      val content = SourceFile(file.name, layout.fs.fileRead(file))
      val parsedValue =
          try {
            content.parseToBeLike(call.location.line).parseLiteral(literalValue.format)
          } catch (e: Exception) {
            throw AssertionError(
                "Error while parsing the literal at ${call.location.ideLink(layout)}. Please report this error at https://github.com/diffplug/selfie",
                e)
          }
      if (parsedValue != literalValue.expected) {
        throw layout.fs.assertFailed(
            "Selfie cannot modify the literal at ${call.location.ideLink(layout)} because Selfie has a parsing bug. Please report this error at https://github.com/diffplug/selfie",
            literalValue.expected,
            parsedValue)
      }
    }
  }
  fun hasWrites(): Boolean = writes.get().isNotEmpty()

  private class FileLineLiteral(val file: TypedPath, val line: Int, val literal: LiteralValue<*>) :
      Comparable<FileLineLiteral> {
    override fun compareTo(other: FileLineLiteral): Int =
        compareValuesBy(this, other, { it.file }, { it.line })
  }
  fun persistWrites(layout: SnapshotFileLayout) {
    // global sort by filename and line, previously might have been polluted by multiple classes
    // within a single file
    val writes =
        writes
            .get()
            .toList()
            .map {
              FileLineLiteral(
                  layout.sourcePathForCall(it.first)!!, it.first.line, it.second.snapshot)
            }
            .sorted()
    if (writes.isEmpty()) {
      return
    }

    var file = writes.first().file
    var content = SourceFile(file.name, layout.fs.fileRead(file))
    var deltaLineNumbers = 0
    for (write in writes) {
      if (write.file != file) {
        layout.fs.fileWrite(file, content.asString)
        file = write.file
        deltaLineNumbers = 0
        content = SourceFile(file.name, layout.fs.fileRead(file))
      }
      // parse the location within the file
      val line = write.line + deltaLineNumbers
      if (write.literal.format == LiteralTodoStub) {
        val kind = write.literal.actual as TodoStub
        content.replaceOnLine(line, ".${kind.name}_TODO(", ".${kind.name}(")
      } else {
        deltaLineNumbers += content.parseToBeLike(line).setLiteralAndGetNewlineDelta(write.literal)
      }
    }
    layout.fs.fileWrite(file, content.asString)
  }
}
