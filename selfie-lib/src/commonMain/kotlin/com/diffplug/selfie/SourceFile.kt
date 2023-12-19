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
package com.diffplug.selfie

/**
 * @param filename The filename (not full path, but the extension is used for language-specific
 *   parsing).
 * @param content The exact content of the file, unix or windows newlines will be preserved
 */
class SourceFile(val filename: String, content: String) {
  private val unixNewlines = content.indexOf('\r') == -1
  private var contentSlice = Slice(content.efficientReplace("\r\n", "\n"))
  private val language =
      when (filename.substringAfterLast('.')) {
        "kt" -> Language.KOTLIN
        "java" -> Language.JAVA_PRE15 // TODO: detect JRE and use JAVA if JVM >= 15
        else -> throw IllegalArgumentException("Unknown language for file $filename")
      }
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
  inner class ToBeLiteral internal constructor(private val slice: Slice) {
    /**
     * Modifies the parent [SourceFile] to set the value within the `toBe` call, and returns the net
     * change in newline count.
     */
    fun <T : Any> setLiteralAndGetNewlineDelta(literalValue: LiteralValue<T>): Int {
      val encoded = literalValue.format.encode(literalValue.actual, language)
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
      // this won't work, because we need to find the `.toBe` and parens
      TODO("return literalFormat.parse(slice.toString())")
    }
  }
  fun parseToBe_TODO(lineOneIndexed: Int): ToBeLiteral {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val idx = lineContent.indexOf(".toBe_TODO()")
    if (idx == -1) {
      throw AssertionError(
          "Expected to find `.toBe_TODO()` on line $lineOneIndexed, but there was only `${lineContent}`")
    }
    return ToBeLiteral(lineContent.subSequence(idx, idx + ".toBe_TODO()".length))
  }
  fun parseToBe(lineOneIndexed: Int): ToBeLiteral {
    TODO("More complicated because we have to actually parse the literal")
  }
}
