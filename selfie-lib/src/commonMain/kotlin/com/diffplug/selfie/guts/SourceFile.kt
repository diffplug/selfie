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

import com.diffplug.selfie.efficientReplace

/**
 * @param filename The filename (not full path, but the extension is used for language-specific
 *   parsing).
 * @param content The exact content of the file, unix or windows newlines will be preserved
 */
class SourceFile(filename: String, content: String) {
  private val unixNewlines = content.indexOf('\r') == -1
  private var contentSlice = Slice(content.efficientReplace("\r\n", "\n"))
  private val language = Language.fromFilename(filename)

  /**
   * Returns the content of the file, possibly modified by
   * [ToBeLiteral.setLiteralAndGetNewlineDelta].
   */
  val asString: String
    get() = contentSlice.toString().let { if (unixNewlines) it else it.replace("\n", "\r\n") }

  /**
   * Represents a section of the sourcecode which is a `.toBe(LITERAL)` call. It might also be
   * `.toBe_TODO()` or ` toBe LITERAL` (infix notation).
   */
  inner class ToBeLiteral
  internal constructor(private val slice: Slice, private val valueStart: Int) {
    /**
     * Modifies the parent [SourceFile] to set the value within the `toBe` call, and returns the net
     * change in newline count.
     */
    fun <T : Any> setLiteralAndGetNewlineDelta(literalValue: LiteralValue<T>): Int {
      val encoded = literalValue.format.encode(literalValue.actual, language)
      val roundTripped = literalValue.format.parse(encoded, language) // sanity check
      if (roundTripped != literalValue.actual) {
        throw Error(
            "There is an error in " +
                literalValue.format::class.simpleName +
                ", the following value isn't round tripping.\n" +
                "Please this error and the data below at https://github.com/diffplug/selfie/issues/new\n" +
                "```\n" +
                "ORIGINAL\n" +
                literalValue.actual +
                "\n" +
                "ROUNDTRIPPED\n" +
                roundTripped +
                "\n" +
                "ENCODED ORIGINAL\n" +
                encoded +
                "\n" +
                "```\n")
      }
      val existingNewlines = slice.count { it == '\n' }
      val newNewlines = encoded.count { it == '\n' }
      contentSlice = Slice(slice.replaceSelfWith(".toBe($encoded)"))
      return newNewlines - existingNewlines
    }

    /**
     * Parses the current value of the value within `.toBe()`. This method should not be called on
     * `toBe_TODO()`.
     */
    fun <T : Any> parseLiteral(literalFormat: LiteralFormat<T>): T {
      return literalFormat.parse(
          slice.subSequence(valueStart, slice.length - 1).toString(), language)
    }
  }
  private fun findOnLine(toFind: String, lineOneIndexed: Int): Slice {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val idx = lineContent.indexOf(toFind)
    if (idx == -1) {
      throw AssertionError(
          "Expected to find `$toFind` on line $lineOneIndexed, but there was only `${lineContent}`")
    }
    return lineContent.subSequence(idx, idx + toFind.length)
  }
  fun replaceToMatchDisk_TODO(lineOneIndexed: Int) {
    val slice = findOnLine(".toMatchDisk_TODO(", lineOneIndexed)
    contentSlice = Slice(slice.replaceSelfWith(".toMatchDisk("))
  }
  fun parseToBe_TODO(lineOneIndexed: Int): ToBeLiteral {
    return parseToBeLike(".toBe_TODO(", lineOneIndexed)
  }
  fun parseToBe(lineOneIndexed: Int): ToBeLiteral {
    return parseToBeLike(".toBe(", lineOneIndexed)
  }
  private fun parseToBeLike(prefix: String, lineOneIndexed: Int): ToBeLiteral {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val idx = lineContent.indexOf(prefix)
    if (idx == -1) {
      throw AssertionError(
          "Expected to find `$prefix)` on line $lineOneIndexed, but there was only `${lineContent}`")
    }
    var opened = 0
    val startIndex = idx + prefix.length
    var endIndex = -1
    // TODO: do we need to detect paired parenthesis ( ( ) )?
    for (i in startIndex ..< lineContent.length) {
      val ch = lineContent[i]
      // TODO: handle () inside string literal
      if (ch == '(') {
        opened += 1
      } else if (ch == ')') {
        if (opened == 0) {
          endIndex = i
          break
        } else {
          opened -= 1
        }
      }
    }
    if (endIndex == -1) {
      throw AssertionError(
          "Expected to find `$prefix)` on line $lineOneIndexed, but there was only `${lineContent}`")
    }
    return ToBeLiteral(lineContent.subSequence(idx, endIndex + 1), prefix.length)
  }
}
