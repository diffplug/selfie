/*
 * Copyright (C) 2023-2025 DiffPlug
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

private const val TRIPLE_QUOTE = "\"\"\""

/**
 * @param filename The filename (not full path, but the extension is used for language-specific
 *   parsing).
 * @param content The exact content of the file, unix or windows newlines will be preserved
 */
class SourceFile(filename: String, content: String, val language: Language) {
  private val unixNewlines = content.indexOf('\r') == -1
  private var contentSlice = Slice(content.efficientReplace("\r\n", "\n"))
  private val escapeLeadingWhitespace =
      EscapeLeadingWhitespace.appropriateFor(contentSlice.toString())

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
  internal constructor(
      private val dotFunOpenParen: String,
      internal val functionCallPlusArg: Slice,
      internal val arg: String,
  ) {
    /**
     * Modifies the parent [SourceFile] to set the value within the `toBe` call, and returns the net
     * change in newline count.
     */
    fun <T : Any> setLiteralAndGetNewlineDelta(literalValue: LiteralValue<T>): Int {
      val encoded =
          literalValue.format.encode(literalValue.actual, language, escapeLeadingWhitespace)
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
      val existingNewlines = functionCallPlusArg.count { it == '\n' }
      val newNewlines = encoded.count { it == '\n' }
      contentSlice = Slice(functionCallPlusArg.replaceSelfWith("${dotFunOpenParen}${encoded})"))
      return newNewlines - existingNewlines
    }

    /**
     * Parses the current value of the value within `.toBe()`. This method should not be called on
     * `toBe_TODO()`.
     */
    fun <T : Any> parseLiteral(literalFormat: LiteralFormat<T>): T {
      return literalFormat.parse(arg, language)
    }
  }
  fun removeSelfieOnceComments() {
    contentSlice = Slice(RemoveSelfieOnceComment.removeSelfieComment(contentSlice.toString()))
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
  fun replaceOnLine(lineOneIndexed: Int, find: String, replace: String) {
    check(find.indexOf('\n') == -1)
    check(replace.indexOf('\n') == -1)
    val slice = findOnLine(find, lineOneIndexed)
    contentSlice = Slice(slice.replaceSelfWith(replace))
  }
  fun parseToBeLike(lineOneIndexed: Int): ToBeLiteral {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val dotFunOpenParen =
        TO_BE_LIKES.mapNotNull {
              val idx = lineContent.indexOf(it)
              if (idx == -1) null else idx to it
            }
            .minByOrNull { it.first }
            ?.second
            ?: throw AssertionError(
                "Expected to find inline assertion on line $lineOneIndexed, but there was only `${lineContent}`")
    val dotFunctionCallInPlace = lineContent.indexOf(dotFunOpenParen)
    val dotFunctionCall = dotFunctionCallInPlace + lineContent.startIndex
    val argStart = dotFunctionCall + dotFunOpenParen.length
    if (contentSlice.length == argStart) {
      throw AssertionError(
          "Appears to be an unclosed function call `$dotFunOpenParen)` on line $lineOneIndexed")
    }

    var commaDelimitedNewlines: MutableList<Slice>? = null
    val arg = argSlice(argStart, dotFunOpenParen, lineOneIndexed)
    var endParen = arg.endIndex
    while (contentSlice[endParen] != ')') {
      val nextChar = contentSlice[endParen]
      if (nextChar == ',') {
        val nextArg = argSlice(endParen + 1, dotFunOpenParen, lineOneIndexed)
        if (commaDelimitedNewlines == null) {
          commaDelimitedNewlines = mutableListOf(arg, nextArg)
        } else {
          commaDelimitedNewlines.add(nextArg)
        }
        endParen = nextArg.endIndex - 1
      } else if (!nextChar.isWhitespace()) {
        throw AssertionError(
            "Non-primitive literal in `$dotFunOpenParen)` starting at line $lineOneIndexed: error for character `${contentSlice[endParen]}` on line ${contentSlice.baseLineAtOffset(endParen)}")
      }
      ++endParen
      if (endParen == contentSlice.length) {
        throw AssertionError(
            "Appears to be an unclosed function call `$dotFunOpenParen)` starting at line $lineOneIndexed")
      }
    }
    val fullArg =
        if (commaDelimitedNewlines == null) arg.toString()
        else
            commaDelimitedNewlines.joinToString("\\n", "\"", "\"") {
              check(it.startsWith("\"") && it.endsWith("\"")) {
                "Expected string literal to start with a single quote on line ${
                    it.baseLineAtOffset(
                        0
                    )
                }"
              }
              it.subSequence(1, it.length - 1)
            }
    return ToBeLiteral(
        dotFunOpenParen.replace("_TODO", ""),
        contentSlice.subSequence(dotFunctionCall, endParen + 1),
        fullArg)
  }

  companion object {
    internal inline fun commaDelimitedParseCleanup(str: String): String =
        str.efficientReplace("\",\n\"", "\\n")
  }
  private fun argSlice(
      argStartInitial: Int,
      dotFunOpenParen: String,
      lineOneIndexed: Int,
  ): Slice {
    var argStart = argStartInitial
    while (contentSlice[argStart].isWhitespace()) {
      ++argStart
      if (contentSlice.length == argStart) {
        throw AssertionError(
            "Appears to be an unclosed function call `$dotFunOpenParen)` on line $lineOneIndexed")
      }
    }
    // argStart is now the first non-whitespace character after the opening paren
    var endArg: Int
    if (contentSlice[argStart] == '"') {
      if (contentSlice.subSequence(argStart, contentSlice.length).startsWith(TRIPLE_QUOTE)) {
        endArg = contentSlice.indexOf(TRIPLE_QUOTE, argStart + TRIPLE_QUOTE.length)
        if (endArg == -1) {
          throw AssertionError(
              "Appears to be an unclosed multiline string literal `${TRIPLE_QUOTE}` on line $lineOneIndexed")
        } else {
          endArg += TRIPLE_QUOTE.length
        }
      } else {
        endArg = argStart + 1
        while (contentSlice[endArg] != '"' || contentSlice[endArg - 1] == '\\') {
          ++endArg
          if (endArg == contentSlice.length) {
            throw AssertionError(
                "Appears to be an unclosed string literal `\"` on line $lineOneIndexed")
          }
        }
        endArg += 1
      }
    } else {
      endArg = argStart
      while (!contentSlice[endArg].isWhitespace()) {
        if (contentSlice[endArg] == ')') {
          break
        }
        ++endArg
        if (endArg == contentSlice.length) {
          throw AssertionError("Appears to be an unclosed numeric literal on line $lineOneIndexed")
        }
      }
    }
    return contentSlice.subSequence(argStart, endArg)
  }
}
private val TO_BE_LIKES = listOf(".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO(")
