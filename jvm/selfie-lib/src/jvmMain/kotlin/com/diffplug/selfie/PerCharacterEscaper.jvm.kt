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
package com.diffplug.selfie

internal actual fun codePointAt(s: String, i: Int): Int = s.codePointAt(i)

internal actual fun charCount(codePoint: Int): Int = Character.charCount(codePoint)

internal actual fun codePoints(s: String): IntArray = s.codePoints().toArray()

internal actual fun StringBuilder.appendCP(codePoint: Int) = this.appendCodePoint(codePoint)

/**
 * If your escape policy is "'123", it means this:
 * ```
 * abc->abc
 * 123->'1'2'3
 * I won't->I won''t
 * ```
 */
actual class PerCharacterEscaper
/**
 * The first character in the string will be uses as the escape character, and all characters will
 * be escaped.
 */
private constructor(
    private val escapeCodePoint: Int,
    private val escapedCodePoints: IntArray,
    private val escapedByCodePoints: IntArray
) {
  private fun firstOffsetNeedingEscape(input: String): Int {
    val length = input.length
    var firstOffsetNeedingEscape = -1
    var offset = 0
    outer@ while (offset < length) {
      val codepoint = codePointAt(input, offset)
      for (escaped in escapedCodePoints) {
        if (codepoint == escaped) {
          firstOffsetNeedingEscape = offset
          break@outer
        }
      }
      offset += charCount(codepoint)
    }
    return firstOffsetNeedingEscape
  }
  actual fun escape(input: String): String {
    val noEscapes = firstOffsetNeedingEscape(input)
    return if (noEscapes == -1) {
      input
    } else {
      val length = input.length
      val needsEscapes = length - noEscapes
      val builder = StringBuilder(noEscapes + 4 + needsEscapes * 5 / 4)
      builder.append(input, 0, noEscapes)
      var offset = noEscapes
      while (offset < length) {
        val codepoint = codePointAt(input, offset)
        offset += charCount(codepoint)
        val idx = indexOf(escapedCodePoints, codepoint)
        if (idx == -1) {
          builder.appendCP(codepoint)
        } else {
          builder.appendCP(escapeCodePoint)
          builder.appendCP(escapedByCodePoints[idx])
        }
      }
      builder.toString()
    }
  }
  private fun firstOffsetNeedingUnescape(input: String): Int {
    val length = input.length
    var firstOffsetNeedingEscape = -1
    var offset = 0
    while (offset < length) {
      val codepoint = codePointAt(input, offset)
      if (codepoint == escapeCodePoint) {
        firstOffsetNeedingEscape = offset
        break
      }
      offset += charCount(codepoint)
    }
    return firstOffsetNeedingEscape
  }
  actual fun unescape(input: String): String {
    val noEscapes = firstOffsetNeedingUnescape(input)
    return if (noEscapes == -1) {
      input
    } else {
      val length = input.length
      val needsEscapes = length - noEscapes
      val builder = StringBuilder(noEscapes + 4 + needsEscapes * 5 / 4)
      builder.append(input, 0, noEscapes)
      var offset = noEscapes
      while (offset < length) {
        var codepoint = codePointAt(input, offset)
        offset += charCount(codepoint)
        // if we need to escape something, escape it
        if (codepoint == escapeCodePoint) {
          if (offset < length) {
            codepoint = codePointAt(input, offset)
            val idx = indexOf(escapedByCodePoints, codepoint)
            if (idx != -1) {
              codepoint = escapedCodePoints[idx]
            }
            offset += charCount(codepoint)
          } else {
            throw IllegalArgumentException(
                StringBuilder()
                    .append("Escape character '")
                    .appendCP(escapeCodePoint)
                    .append("' can't be the last character in a string.")
                    .toString())
          }
        }
        // we didn't escape it, append it raw
        builder.appendCP(codepoint)
      }
      builder.toString()
    }
  }

  actual companion object {
    private fun indexOf(arr: IntArray, target: Int): Int {
      for ((index, value) in arr.withIndex()) {
        if (value == target) {
          return index
        }
      }
      return -1
    }
    actual fun selfEscape(escapePolicy: String): PerCharacterEscaper {
      val escapedCodePoints = codePoints(escapePolicy)
      val escapeCodePoint = escapedCodePoints[0]
      return PerCharacterEscaper(escapeCodePoint, escapedCodePoints, escapedCodePoints)
    }
    actual fun specifiedEscape(escapePolicy: String): PerCharacterEscaper {
      val codePoints = codePoints(escapePolicy)
      require(codePoints.size % 2 == 0)
      val escapeCodePoint = codePoints[0]
      val escapedCodePoints = IntArray(codePoints.size / 2)
      val escapedByCodePoints = IntArray(codePoints.size / 2)
      for (i in escapedCodePoints.indices) {
        escapedCodePoints[i] = codePoints[2 * i]
        escapedByCodePoints[i] = codePoints[2 * i + 1]
      }
      return PerCharacterEscaper(escapeCodePoint, escapedCodePoints, escapedByCodePoints)
    }
  }
}
