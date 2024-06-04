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

internal actual fun codePointAt(s: String, i: Int): Int = js("s.codePointAt(i)")

private const val MIN_SUPPLEMENTARY_CODE_POINT = 0x010000
private const val MAX_CODE_POINT = 0X10FFFF
private const val MIN_LOW_SURROGATE = '\uDC00'
private const val MIN_HIGH_SURROGATE = '\uD800'

internal actual fun charCount(codePoint: Int): Int =
    if (codePoint >= MIN_SUPPLEMENTARY_CODE_POINT) 2 else 1

internal actual fun codePoints(s: String): IntArray {
  val result = mutableListOf<Int>()
  var offset = 0
  while (offset < s.length) {
    val codepoint = codePointAt(s, offset)
    result.add(codepoint)
    offset += 1
  }
  return result.toIntArray()
}
private fun highSurrogate(codePoint: Int): Char {
  return ((codePoint ushr 10) + (MIN_HIGH_SURROGATE - (MIN_SUPPLEMENTARY_CODE_POINT ushr 10)).code)
      .toChar()
}
private fun lowSurrogate(codePoint: Int): Char {
  return ((codePoint and 0x3ff) + MIN_LOW_SURROGATE.code).toChar()
}
private fun isBmpCodePoint(codePoint: Int): Boolean {
  return codePoint ushr 16 == 0
}
private fun isValidCodePoint(codePoint: Int): Boolean {
  // Optimized form of:
  //     codePoint >= MIN_CODE_POINT && codePoint <= MAX_CODE_POINT
  val plane = codePoint ushr 16
  return plane < MAX_CODE_POINT + 1 ushr 16
}

internal actual fun StringBuilder.appendCP(codePoint: Int): StringBuilder {
  if (isBmpCodePoint(codePoint)) {
    append(codePoint.toChar())
  } else if (isValidCodePoint(codePoint)) {
    append(highSurrogate(codePoint))
    append(lowSurrogate(codePoint))
  } else {
    throw IllegalArgumentException("Not a valid Unicode code point: $codePoint")
  }
  return this
}
