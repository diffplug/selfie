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
package com.diffplug.selfie.kotest

import com.diffplug.selfie.guts.TypedPath
import io.kotest.core.spec.style.StringSpec
import io.kotest.core.test.TestCaseOrder
import io.kotest.matchers.shouldBe
import okio.Path
import okio.Path.Companion.toPath

expect val IS_WINDOWS: Boolean

expect fun exec(cwd: TypedPath, vararg args: String): String

open class HarnessKotest() : StringSpec() {
  override fun testCaseOrder(): TestCaseOrder? = TestCaseOrder.Sequential
  val subprojectFolder: Path

  init {
    val subproject = "undertest-kotest"
    var rootFolder = FS_SYSTEM.canonicalize("".toPath())
    if (!FS_SYSTEM.exists(rootFolder.resolve("settings.gradle"))) {
      check(FS_SYSTEM.exists(rootFolder.parent!!.resolve("settings.gradle"))) {
        "The root folder must contain settings.gradle, was not present in\n" +
            "  $rootFolder\n" +
            "  ${rootFolder.parent}"
      }
      rootFolder = rootFolder.parent!!
    }
    subprojectFolder = rootFolder.resolve(subproject)
    check(FS_SYSTEM.exists(subprojectFolder)) { "The subproject folder $subproject must exist" }
  }
  private fun thisClassName(): String = this::class.simpleName!!
  protected fun ut_mirrorKt() = file("UT_${thisClassName()}.kt")
  protected fun ut_snapshot() = file("UT_${thisClassName()}.ss")
  fun file(nameOrSubpath: String): FileHarness {
    return if (nameOrSubpath.contains('/')) {
      FileHarness(nameOrSubpath)
    } else {
      val matches =
          FS_SYSTEM.listRecursively(subprojectFolder)
              .filter { it.name == nameOrSubpath && !it.toString().contains("build") }
              .toList()
      when (matches.size) {
        0 -> FileHarness(nameOrSubpath)
        1 -> FileHarness(matches[0].relativeTo(subprojectFolder).toString())
        else -> {
          val allMatches = matches.map { it.relativeTo(subprojectFolder) }.joinToString("\n  ")
          throw AssertionError(
              "Expected to find exactly one file named $nameOrSubpath, but found ${matches.size}:\n  $allMatches")
        }
      }
    }
  }

  inner class FileHarness(val subpath: String) {
    fun restoreFromGit() {
      val path = subprojectFolder.resolve(subpath)
      exec(TypedPath.ofFolder(subprojectFolder.toString()), "git", "checkout", "**/${path.name}")
    }
    fun assertDoesNotExist() {
      if (FS_SYSTEM.exists(subprojectFolder.resolve(subpath))) {
        throw AssertionError("Expected $subpath to not exist, but it does")
      }
    }
    fun deleteIfExists() {
      if (FS_SYSTEM.exists(subprojectFolder.resolve(subpath))) {
        FS_SYSTEM.delete(subprojectFolder.resolve(subpath))
      }
    }
    fun assertContent(expected: String) {
      FS_SYSTEM.read(subprojectFolder.resolve(subpath)) {
        val actual = readUtf8()
        actual shouldBe expected
      }
    }
    fun setContent(content: String) {
      FS_SYSTEM.write(subprojectFolder.resolve(subpath)) { writeUtf8(content) }
    }
    fun linesFrom(start: String): LineRangeSelector {
      FS_SYSTEM.read(subprojectFolder.resolve(subpath)) {
        val allLines = mutableListOf<String>()
        while (!exhausted()) {
          readUtf8Line()?.let { allLines.add(it) }
        }
        val matchingLines =
            allLines.mapIndexedNotNull() { index, line ->
              // TODO: probably need more than ignore import??
              if (line.contains(start) && !line.contains("import ")) "L$index: $line" else null
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
        check(startInclusive >= 0)
        check(endInclusive >= startInclusive)
        check(lines.size >= endInclusive)
      }
      fun shrinkByOne() = LineRange(lines, startInclusive + 1, endInclusive - 1)

      /** Prepend `//` to every line in this range and save it to disk. */
      fun commentOut() = mutateLinesAndWriteToDisk { lineNumber, line ->
        if (line.trim().startsWith("//")) {
          line
        } else "//$line"
      }
      fun uncomment() = mutateLinesAndWriteToDisk { lineNumber, line ->
        if (line.trim().startsWith("//")) {
          line.trim().substring(2)
        } else line
      }
      fun assertCommented(isCommented: Boolean) = mutateLinesAndWriteToDisk { lineNumber, line ->
        check(line.trim().isEmpty() || line.startsWith("//") == isCommented) {
          "Expected L$lineNumber to ${if (isCommented) "be" else "not be"} commented, was $line"
        }
        line
      }
      private inline fun mutateLinesAndWriteToDisk(mutator: (Int, String) -> String) {
        for (i in startInclusive..endInclusive) {
          lines[i] = mutator(i + 1, lines[i])
        }
        FS_SYSTEM.write(subprojectFolder.resolve(subpath)) {
          for (line in lines) {
            writeUtf8(line)
            writeUtf8("\n")
          }
        }
      }
      fun content() = lines.subList(startInclusive, endInclusive + 1).joinToString("\n")
      fun setContent(mustBe: String) {
        FS_SYSTEM.write(subprojectFolder.resolve(subpath)) {
          for (i in 0 ..< startInclusive) {
            writeUtf8(lines[i])
            writeUtf8("\n")
          }
          writeUtf8(mustBe)
          writeUtf8("\n")
          for (i in endInclusive + 1 ..< lines.size) {
            writeUtf8(lines[i])
            writeUtf8("\n")
          }
        }
      }
    }
  }
  fun gradlew(task: String, vararg args: String): AssertionError? {
    val actualTask =
        when (task) {
          "test" -> "jvmTest"
          else -> throw IllegalArgumentException("Unknown task $task")
        }
    val argList = mutableListOf<String>()
    if (IS_WINDOWS) {
      argList.add("cmd")
      argList.add("/c")
    } else {
      argList.add("/bin/sh")
      argList.add("-c")
    }
    argList.add(
        "${if (IS_WINDOWS) "" else "./"}gradlew :undertest-kotest:$actualTask --configuration-cache ${args.joinToString(" ")}")
    val output =
        exec(TypedPath.ofFolder(subprojectFolder.parent.toString()), *argList.toTypedArray())
    if (output.contains("BUILD SUCCESSFUL")) {
      return null
    } else {
      val errorReport = output.indexOf("> There were failing tests. See the report at: ")
      if (errorReport == -1) {
        throw AssertionError("Expected to find 'There were failing tests', was:\n\n$output")
      }
      val pathStart = output.indexOf("file://", errorReport)
      val newline = output.indexOf("\n", errorReport)
      check(pathStart != -1 && newline != -1) { "pathStart=$pathStart newline=$newline" }
      val pathStr = output.substring(pathStart + "file://".length, newline)
      return FS_SYSTEM.read(pathStr.toPath()) { AssertionError(readUtf8()) }
    }
  }
  fun gradleWriteSS() {
    gradlew("test", "-PunderTest=true", "-Pselfie=overwrite")?.let {
      throw AssertionError("Expected write snapshots to succeed, but it failed", it)
    }
  }
  fun gradleReadSS() {
    gradlew("test", "-PunderTest=true", "-Pselfie=readonly")?.let {
      throw AssertionError("Expected read snapshots to succeed, but it failed", it)
    }
  }
  fun gradleReadSSFail(): AssertionError {
    val failure = gradlew("test", "-PunderTest=true", "-Pselfie=readonly")
    if (failure == null) {
      throw AssertionError("Expected read snapshots to fail, but it succeeded.")
    } else {
      return failure
    }
  }
  fun gradleInteractivePass() {
    gradlew("test", "-PunderTest=true", "-Pselfie=interactive")?.let {
      throw AssertionError("Expected interactive selfie run to succeed, but it failed.", it)
    }
  }
  fun gradleInteractiveFail(): AssertionError {
    val failure = gradlew("test", "-PunderTest=true", "-Pselfie=interactive")
    if (failure == null) {
      throw AssertionError("Expected interactive selfie run to fail, but it succeeded.")
    } else {
      return failure
    }
  }
}
