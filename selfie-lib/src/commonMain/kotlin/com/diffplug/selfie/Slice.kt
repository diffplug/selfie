/*
 * Copyright (C) 2019-2023 DiffPlug
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

internal class Slice(val base: String, val startIndex: Int = 0, val endIndex: Int = base.length) :
    CharSequence {
  init {
    require(0 <= startIndex)
    require(startIndex <= endIndex)
    require(endIndex <= base.length)
  }
  override val length: Int
    get() = endIndex - startIndex
  override fun get(index: Int): Char = base[startIndex + index]
  override fun subSequence(start: Int, end: Int): Slice =
      Slice(base, startIndex + start, startIndex + end)

  /** Same behavior as [String.trim]. */
  fun trim(): Slice {
    var end = length
    var start = 0
    while (start < end && get(start).isWhitespace()) {
      ++start
    }
    while (start < end && get(end - 1).isWhitespace()) {
      --end
    }
    return if (start > 0 || end < length) subSequence(start, end) else this
  }
  override fun toString() = base.subSequence(startIndex, endIndex).toString()
  fun sameAs(other: CharSequence): Boolean {
    if (length != other.length) {
      return false
    }
    for (i in 0 until length) {
      if (get(i) != other[i]) {
        return false
      }
    }
    return true
  }
  fun indexOf(lookingFor: String, startOffset: Int = 0): Int {
    val result = base.indexOf(lookingFor, startIndex + startOffset)
    return if (result == -1 || result >= endIndex) -1 else result - startIndex
  }
  fun indexOf(lookingFor: Char, startOffset: Int = 0): Int {
    val result = base.indexOf(lookingFor, startIndex + startOffset)
    return if (result == -1 || result >= endIndex) -1 else result - startIndex
  }
  /** Returns a slice at the nth line. Handy for expanding the slice from there. */
  fun unixLine(count: Int): Slice {
    check(count > 0)
    var lineStart = 0
    for (i in 1 until count) {
      lineStart = indexOf('\n', lineStart)
      require(lineStart >= 0) { "This string has only ${i - 1} lines, not $count" }
      ++lineStart
    }
    val lineEnd = indexOf('\n', lineStart)
    return if (lineEnd == -1) {
      Slice(base, startIndex + lineStart, endIndex)
    } else {
      Slice(base, startIndex + lineStart, startIndex + lineEnd)
    }
  }
  override fun equals(other: Any?) =
      if (this === other) {
        true
      } else if (other is Slice) {
        sameAs(other)
      } else {
        false
      }
  override fun hashCode(): Int {
    var h = 0
    for (i in indices) {
      h = 31 * h + get(i).code
    }
    return h
  }
  /** Returns the underlying string with this slice replaced by the given string. */
  fun replaceSelfWith(s: String): String {
    val deltaLength = s.length - length
    val builder = StringBuilder(base.length + deltaLength)
    builder.appendRange(base, 0, startIndex)
    builder.append(s)
    builder.appendRange(base, endIndex, base.length)
    return builder.toString()
  }
}
