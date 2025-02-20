/*
 * Copyright (C) 2024-2025 DiffPlug
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

import java.util.stream.Collectors

private const val UNKNOWN_METHOD = "<unknown>"

/** Represents the line at which user code called into Selfie. */
actual data class CallLocation(
    val clazz: String,
    val method: String,
    actual val fileName: String?,
    actual val line: Int
) : Comparable<CallLocation> {
  actual fun withLine(line: Int): CallLocation = CallLocation(clazz, UNKNOWN_METHOD, fileName, line)
  actual fun samePathAs(other: CallLocation): Boolean =
      clazz == other.clazz && fileName == other.fileName
  actual override fun compareTo(other: CallLocation): Int =
      compareValuesBy(this, other, { it.clazz }, { it.method }, { it.fileName }, { it.line })

  /**
   * If the runtime didn't give us the filename, guess it from the class, and try to find the source
   * file by walking the CWD. If we don't find it, report it as a `.class` file.
   */
  private fun findFileIfAbsent(layout: SnapshotFileLayout): String {
    if (fileName != null) {
      return fileName
    }
    return layout.sourcePathForCallMaybe(this)?.let { it.name }
        ?: "${clazz.substringAfterLast('.')}.class"
  }

  /** A `toString` which an IDE will render as a clickable link. */
  actual fun ideLink(layout: SnapshotFileLayout): String =
      "$clazz.$method(${findFileIfAbsent(layout)}:$line)"
  /** Returns the likely name of the sourcecode of this file, without path or extension. */
  actual fun sourceFilenameWithoutExtension(): String =
      clazz.substringAfterLast('.').substringBefore('$')
}

/** Generates a CallLocation and the CallStack behind it. */
internal actual fun recordCall(callerFileOnly: Boolean): CallStack =
    StackWalker.getInstance().walk { frames ->
      val framesWithDrop =
          frames.dropWhile {
            it.className.startsWith("com.diffplug.selfie.") || it.className.startsWith("selfie.")
          }
      if (callerFileOnly) {
        val caller =
            framesWithDrop
                .limit(1)
                .map { CallLocation(it.className, UNKNOWN_METHOD, it.fileName, -1) }
                .findFirst()
                .get()
        CallStack(caller, emptyList())
      } else {
        val fullStack =
            framesWithDrop
                .map { CallLocation(it.className, it.methodName, it.fileName, it.lineNumber) }
                .collect(Collectors.toList())
        CallStack(fullStack.get(0), fullStack.subList(1, fullStack.size))
      }
    }
