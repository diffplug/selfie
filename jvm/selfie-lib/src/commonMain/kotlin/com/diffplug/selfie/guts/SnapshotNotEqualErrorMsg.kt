/*
 * Copyright (C) 2024 DiffPlug
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

object SnapshotNotEqualErrorMsg {
  const val REASONABLE_LINE_LENGTH = 120
  fun forUnequalStrings(expected: String, actual: String): String {
    var lineNumber = 1
    var columnNumber = 1
    var index = 0

    while (index < expected.length && index < actual.length) {
      val expectedChar = expected[index]
      val actualChar = actual[index]
      if (expectedChar != actualChar) {
        val endOfLineExpected =
            expected.indexOf('\n', index).let { if (it == -1) expected.length else it }
        val endOfLineActual =
            actual.indexOf('\n', index).let { if (it == -1) actual.length else it }
        val expectedLine = expected.substring(index - columnNumber + 1, endOfLineExpected)
        val actualLine = actual.substring(index - columnNumber + 1, endOfLineActual)
        return "Snapshot mismatch at L$lineNumber:C$columnNumber\n-$expectedLine\n+$actualLine"
      }
      if (expectedChar == '\n') {
        lineNumber++
        columnNumber = 1
      } else {
        columnNumber++
      }
      index++
    }
    val endOfLineExpected =
        expected.indexOf('\n', index).let { if (it == -1) expected.length else it }
    val endOfLineActual = actual.indexOf('\n', index).let { if (it == -1) actual.length else it }

    if (endOfLineActual == endOfLineExpected) {
      // it ended at a line break
      val longer = if (actual.length > expected.length) actual else expected
      val added = if (actual.length > expected.length) "+" else "-"
      val endIdx =
          longer.indexOf('\n', endOfLineActual + 1).let { if (it == -1) longer.length else it }
      val line = longer.substring(endOfLineActual + 1, endIdx)
      return "Snapshot mismatch at L${lineNumber+1}:C1 - line(s) ${if (added == "+") "added" else "removed"}\n${added}$line"
    } else {
      val expectedLine = expected.substring(index - columnNumber + 1, endOfLineExpected)
      val actualLine = actual.substring(index - columnNumber + 1, endOfLineActual)
      return "Snapshot mismatch at L$lineNumber:C$columnNumber\n-$expectedLine\n+$actualLine"
    }
  }
}
