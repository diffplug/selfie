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

import io.kotest.matchers.shouldBe
import okio.FileSystem
import okio.Path
import okio.Path.Companion.toPath

open class Harness(rootFolderStr: String) {
  val rootFolder: Path

  init {
    rootFolder = FileSystem.SYSTEM.canonicalize(rootFolderStr.toPath())
    check(FileSystem.SYSTEM.exists(rootFolder)) { "The root folder $rootFolder must exist" }
  }
  fun file(nameOrSubpath: String): FileHarness {
    return if (nameOrSubpath.contains('/')) {
      FileHarness(nameOrSubpath)
    } else {
      val matches =
          FileSystem.SYSTEM.listRecursively(rootFolder)
              .filter { it.name == nameOrSubpath && !it.toString().contains("build") }
              .toList()
      assert(matches.size <= 1) {
        val allMatches = matches.map { it.relativeTo(rootFolder) }.joinToString("\n  ")
        "Expected to find exactly one file named $nameOrSubpath, but found ${matches.size}:\n  $allMatches"
      }
      FileHarness(matches[0].relativeTo(rootFolder).toString())
    }
  }

  inner class FileHarness(val subpath: String) {
    fun assertDoesNotExist() {
      if (FileSystem.SYSTEM.exists(rootFolder.resolve(subpath))) {
        throw AssertionError("Expected $subpath to not exist, but it does")
      }
    }
    fun assertContent(expected: String) {
      FileSystem.SYSTEM.read(rootFolder.resolve(subpath)) {
        val actual = readUtf8()
        actual shouldBe expected
      }
    }
    fun setContent(content: String) {
      FileSystem.SYSTEM.write(rootFolder.resolve(subpath)) { writeUtf8(content) }
    }
    fun linesFrom(start: String): LineRangeSelector {
      FileSystem.SYSTEM.read(rootFolder.resolve(subpath)) {
        val allLines = mutableListOf<String>()
        while (!exhausted()) {
          readUtf8Line()?.let { allLines.add(it) }
        }
        val matchingLines =
            allLines.mapIndexedNotNull() { index, line ->
              if (line.contains(start)) "L$index: $line" else null
            }
        if (matchingLines.size == 1) {
          val idx = matchingLines[0].substringAfter("L").substringBefore(":").toInt()
          return LineRangeSelector(allLines, idx)
        } else {
          throw AssertionError(
              "Expected to find exactly one line containing $start in $subpath, but found ${matchingLines.size}:\n  ${matchingLines.joinToString("\n  ")}")
        }
      }
    }
    fun lineWith(contains: String): LineRange {
      val selector = linesFrom(contains)
      return LineRange(selector.lines, selector.start, selector.start)
    }

    inner class LineRangeSelector(val lines: MutableList<String>, val start: Int) {
      fun toFirst(end: String): LineRange {
        val idx = lines.subList(start + 1, lines.size).indexOfFirst { it.contains(end) }
        return tryReturn(end, start + 1 + idx)
      }
      fun toLast(end: String): LineRange {
        val idx = lines.indexOfLast { it.contains(end) }
        return tryReturn(end, idx)
      }
      private fun tryReturn(end: String, idx: Int): LineRange {
        if (idx < start) {
          throw AssertionError(
              "There are no lines containing '$end' after L$start: ${lines[start]}")
        }
        return LineRange(lines, start, idx)
      }
    }

    inner class LineRange(
        val lines: MutableList<String>,
        val startInclusive: Int,
        val endInclusive: Int
    ) {
      init {
        assert(startInclusive >= 0)
        assert(endInclusive >= startInclusive)
        assert(lines.size >= endInclusive)
      }
      fun shrinkByOne() = LineRange(lines, startInclusive + 1, endInclusive - 1)
      /** Prepend `//` to every line in this range and save it to disk. */
      fun commentOut() = mutateLinesAndWriteToDisk { lineNumber, line ->
        assert(!line.startsWith("//")) { "Expected L$lineNumber to not start with //, was $line" }
        "//$line"
      }
      fun uncomment() = mutateLinesAndWriteToDisk { lineNumber, line ->
        assert(line.startsWith("//")) { "Expected L$lineNumber to start with //, was $line" }
        line.substring(2)
      }
      fun assertCommented(isCommented: Boolean) = mutateLinesAndWriteToDisk { lineNumber, line ->
        assert(line.trim().isEmpty() || line.startsWith("//") == isCommented) {
          "Expected L$lineNumber to ${if (isCommented) "be" else "not be"} commented, was $line"
        }
        line
      }
      private inline fun mutateLinesAndWriteToDisk(mutator: (Int, String) -> String) {
        for (i in startInclusive..endInclusive) {
          lines[i] = mutator(i + 1, lines[i])
        }
        FileSystem.SYSTEM.write(rootFolder.resolve(subpath)) {
          for (line in lines) {
            writeUtf8(line)
            writeUtf8("\n")
          }
        }
      }
    }
  }
  fun gradlew(vararg args: String) {
    TODO()
  }
}
