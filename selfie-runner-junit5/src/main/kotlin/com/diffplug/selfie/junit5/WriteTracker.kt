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
import java.nio.file.Files
import java.nio.file.Path
import java.util.regex.Matcher
import java.util.regex.Pattern
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
private fun String.countNewlines(): Int = lineOffset { true }.size
private fun String.lineOffset(filter: (Int) -> Boolean): List<Int> {
  val lineTerminator = "\n"
  var offset = 0
  var next = indexOf(lineTerminator, offset)
  val offsets = mutableListOf<Int>()
  while (next != -1 && filter(offsets.size)) {
    offsets.add(offset)
    offset = next + lineTerminator.length
    next = indexOf(lineTerminator, offset)
  }
  return offsets
}

internal class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue<*>>() {
  fun record(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    recordInternal(call.location, literalValue, call, layout)
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
    var contentOfFile = Files.readString(file)
    var deltaLineNumbers = 0
    // If I was implementing this, I would use Slice https://github.com/diffplug/selfie/pull/22
    // as the type of source, but that is by no means a requirement
    for (write in writes) {
      if (write.file != file) {
        Files.writeString(file, contentOfFile)
        file = write.file
        deltaLineNumbers = 0
        contentOfFile = Files.readString(file)
      }
      // parse the location within the file
      val line = write.line + deltaLineNumbers
      val offsets = contentOfFile.lineOffset { it <= line + 1 }
      val startOffset = offsets[line]
      // TODO: multi-line support
      val endOffset =
          if (line + 1 < offsets.size) {
            offsets[line + 1]
          } else {
            contentOfFile.length
          }
      val matcher = parseExpectSelfie(contentOfFile.substring(startOffset, endOffset))
      val currentlyInFile = matcher.group(2)
      val parsedInFile = write.literal.format.parse(currentlyInFile)
      if (parsedInFile != write.literal.expected) {
        // warn that the parsing wasn't as expected
        // TODO: we can't report failures to the user very well
        //   someday, we should verify that the parse works in the `record()` and
        //   throw an `AssertionFail` there so that the user sees it early
      }
      val toInjectIntoFile = write.literal.encodedActual()
      deltaLineNumbers += (toInjectIntoFile.countNewlines() - currentlyInFile.countNewlines())
      contentOfFile =
          contentOfFile.replaceRange(
              startOffset, endOffset, matcher.replaceAll("$1$toInjectIntoFile$3"))
    }
    file?.let { Files.writeString(it, contentOfFile) }
  }
  private fun replaceLiteral(matcher: Matcher, toInjectIntoFile: String): CharSequence {
    val sb = StringBuilder()
    matcher.appendReplacement(sb, toInjectIntoFile)
    matcher.appendTail(sb)
    return sb
  }
  private fun parseExpectSelfie(source: String): Matcher {
    // TODO: support multi-line parsing
    val pattern = Pattern.compile("^(\\s*expectSelfie\\()([^)]*)(\\))", Pattern.MULTILINE)
    val matcher = pattern.matcher(source)
    if (matcher.find()) {
      return matcher
    } else {
      TODO("Unexpected line: $source")
    }
  }
}
