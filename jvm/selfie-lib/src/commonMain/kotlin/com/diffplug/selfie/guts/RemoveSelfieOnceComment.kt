/*
 * Copyright (C) 2025 DiffPlug
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

internal object RemoveSelfieOnceComment {
  // Regex to match a valid "//selfieonce" comment (with optional whitespace)
  private val selfieOnceRegex = "^\\s*//\\s*selfieonce\\s*\$".toRegex()

  /**
   * Removes all "//selfieonce" comments from the source code. Ignores occurrences inside string
   * literals and block comments.
   *
   * @param source the source code to be processed
   * @return the source code with all "//selfieonce" comments removed. If no comments were found,
   *   the source code is returned unchanged.
   */
  fun removeSelfieComment(source: String): String {
    val rangesForRemoval = findSelfieOnceCommentRanges(source)
    if (rangesForRemoval.isEmpty()) {
      return source
    }
    return applyRemovals(source, rangesForRemoval)
  }

  /**
   * Finds all "//selfieonce" comments in the source code and returns their ranges. Ignores
   * occurrences inside string literals and block comments.
   *
   * @param source the source code to be processed
   * @return a list of integer pairs representing the start and end index of each comment
   */
  private fun findSelfieOnceCommentRanges(source: String): List<Pair<Int, Int>> {
    // Track the last 3 characters to detect triple quotes and comments
    var currentChar = '0'
    var prevChar = '0'
    var prevPrevChar = '0'

    // State tracking
    var isInsideBlockComment = false
    var isInsideStringLiteral = false
    var isInsideInlineComment = false
    var commentStartIdx = -1
    val contentBuilder = StringBuilder()
    val rangesForRemoval = mutableListOf<Pair<Int, Int>>()

    for (srcCharIndex in source.indices) {
      // Update character history
      prevPrevChar = prevChar
      prevChar = currentChar
      currentChar = source[srcCharIndex]
      val isEndOfInlineComment =
          isInsideInlineComment && (currentChar == '\r' || currentChar == '\n')
      if (isEndOfInlineComment) {
        isInsideInlineComment = false
      }
      // Update parsing state based on the current character
      val isStartOfTripleQuoteString =
          !isInsideInlineComment &&
              !isInsideBlockComment &&
              currentChar == '"' &&
              prevChar == '"' &&
              prevPrevChar == '"'
      if (isStartOfTripleQuoteString) {
        // Toggle string literal state on triple quotes only if not in a comment
        isInsideStringLiteral = !isInsideStringLiteral
      } else if (!isInsideStringLiteral && currentChar == '*' && prevChar == '/') {
        // Enter block comment
        isInsideBlockComment = true
      } else if (isInsideBlockComment && currentChar == '/' && prevChar == '*') {
        // Exit block comment
        isInsideBlockComment = false
      } else if (!isInsideStringLiteral &&
          !isInsideBlockComment &&
          currentChar == '/' &&
          prevChar == '/') {
        // Enter line comment
        isInsideInlineComment = true
      }

      // Skip processing if inside a block comment or string literal
      if (isInsideBlockComment || isInsideStringLiteral) {
        continue
      }
      if (commentStartIdx != -1) {
        val isEndOfCommentLine =
            currentChar == '\r' || currentChar == '\n' || srcCharIndex == source.lastIndex
        if (isEndOfCommentLine) {
          val isEndOfFile =
              srcCharIndex == source.lastIndex && currentChar != '\r' && currentChar != '\n'
          if (isEndOfFile) {
            contentBuilder.append(currentChar)
          }
          val content = contentBuilder.toString()
          val isSelfieComment = "//$content".matches(selfieOnceRegex)
          if (isSelfieComment) {
            val range = resolveRange(source, commentStartIdx)
            rangesForRemoval.add(range)
          }
          // Reset comment tracking
          commentStartIdx = -1
          contentBuilder.setLength(0)
        } else {
          val isNotNewLine = currentChar != '\r' && currentChar != '\n'
          if (isNotNewLine) {
            contentBuilder.append(currentChar)
          }
        }
      } else if (currentChar == '/' && prevChar == '/') {
        commentStartIdx = srcCharIndex - 1
      }
    }

    return rangesForRemoval
  }

  /** Applies all removals to the source string. */
  private fun applyRemovals(source: String, rangesForRemoval: List<Pair<Int, Int>>): String {
    var result = source
    var offset = 0
    for ((rangeFrom, rangeTo) in rangesForRemoval) {
      result = result.replaceRange(rangeFrom - offset, rangeTo - offset, "")
      offset += rangeTo - rangeFrom
    }
    return result
  }

  /**
   * Resolves the range of a comment, preserving possible source code before the comment. If the
   * comment is on its own line, then the range will include the whole line. If there's source code
   * before the comment, only includes the comment part and any whitespace between source code and
   * comment.
   */
  private fun resolveRange(source: String, atIndex: Int): Pair<Int, Int> {
    val commentStartIndex = atIndex
    val lineStartIndex = findLineStart(source, atIndex)
    val hasCodeBeforeComment = hasSourceCodeBeforeComment(source, lineStartIndex, commentStartIndex)
    val fromIndex =
        determineRemovalStartIndex(source, lineStartIndex, commentStartIndex, hasCodeBeforeComment)
    val toIndex = findLineEnd(source, commentStartIndex)

    return Pair(fromIndex, toIndex)
  }

  /** Finds the start index of the line containing the given index. */
  private fun findLineStart(source: String, fromIndex: Int): Int {
    var lineStartIndex = fromIndex
    while (lineStartIndex > 0) {
      val prevChar = source[lineStartIndex - 1]
      if (prevChar == '\n' || prevChar == '\r') {
        break
      }
      lineStartIndex--
    }

    return lineStartIndex
  }

  /** Checks if there's any non-whitespace content between line start and comment start. */
  private fun hasSourceCodeBeforeComment(
      source: String,
      lineStartIndex: Int,
      commentStartIndex: Int
  ): Boolean {
    for (idx in lineStartIndex until commentStartIndex) {
      if (!source[idx].isWhitespace()) {
        return true
      }
    }
    return false
  }

  /**
   * Determines the start index for removal based on whether there's some source code before the
   * comment.
   */
  private fun determineRemovalStartIndex(
      source: String,
      lineStartIndex: Int,
      commentStartIndex: Int,
      hasCodeBeforeComment: Boolean
  ): Int {
    return if (hasCodeBeforeComment) {
      var lastCodeIndex = commentStartIndex - 1
      while (lastCodeIndex >= lineStartIndex && source[lastCodeIndex].isWhitespace()) {
        lastCodeIndex--
      }
      return lastCodeIndex + 1
    } else {
      lineStartIndex
    }
  }

  /** Finds the end index of the line containing the given index. */
  private fun findLineEnd(source: String, fromIndex: Int): Int {
    var toIndex = fromIndex
    while (toIndex <= source.lastIndex && !(source[toIndex] == '\n' || source[toIndex] == '\r')) {
      toIndex++
    }
    return toIndex
  }
}
