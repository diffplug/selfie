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

import kotlin.jvm.JvmStatic
import kotlin.math.min

/**
 * A [CharSequence] which can efficiently subdivide and append itself.
 *
 * Equal only to other [Slice] with the same [Slice.toString]. Use [Slice.sameAs] to compare with
 * other kinds of [CharSequence].
 */
internal expect fun groupImpl(slice: Slice, matchResult: MatchResult, group: Int): Slice

internal class Slice
private constructor(val base: CharSequence, val startIndex: Int, val endIndex: Int) : CharSequence {
  init {
    require(base is StringBuilder || base is String)
    require(0 <= startIndex)
    require(startIndex <= endIndex)
    require(endIndex <= base.length)
  }
  override val length: Int
    get() = endIndex - startIndex
  override fun get(index: Int): Char = base[startIndex + index]
  override fun subSequence(start: Int, end: Int): Slice {
    return Slice(base, startIndex + start, startIndex + end)
  }

  /** Returns a Slice representing the given group within the given match */
  fun group(matchResult: MatchResult, group: Int): Slice = groupImpl(this, matchResult, group)

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
  fun concat(other: Slice): Slice =
      if (this.isEmpty()) {
        other
      } else if (other.isEmpty()) {
        this
      } else if (base === other.base && endIndex == other.startIndex) {
        Slice(base, startIndex, other.endIndex)
      } else {
        val builder: StringBuilder
        val start: Int
        val end: Int
        if (base is StringBuilder && endIndex == base.length) {
          builder = base
          start = startIndex
          end = endIndex + other.length
        } else {
          builder = StringBuilder(length + other.length)
          builder.append(this)
          start = 0
          end = length + other.length
        }
        other.appendThisTo(builder)
        Slice(builder, start, end)
      }

  /** append(this) but taking advantage of fastpath where possible */
  private fun appendThisTo(builder: StringBuilder) {
    if (startIndex == 0 && endIndex == base.length) {
      // there is a fastpath for adding a full string and for adding a full StringBuilder
      if (base is String) {
        builder.append(base)
      } else {
        builder.append(base as StringBuilder)
      }
    } else {
      builder.append(this)
    }
  }
  fun concat(other: String): Slice {
    if (base is String && endIndex + other.length <= base.length) {
      for (i in other.indices) {
        if (base[i + endIndex] != other[i]) {
          return concat(of(other))
        }
      }
      return Slice(base, startIndex, endIndex + other.length)
    }
    return concat(of(other))
  }
  fun concatAnchored(other: Slice): Slice {
    val result = concat(other)
    if (result.base !== base) {
      throw concatRootFailure(other)
    }
    return result
  }
  fun concatAnchored(other: String): Slice {
    val result = concat(other)
    if (result.base !== base) {
      throw concatRootFailure(other)
    }
    return result
  }
  private fun concatRootFailure(other: CharSequence): IllegalArgumentException {
    val maxChange = min(other.length, base.length - endIndex)
    if (maxChange == 0) {
      return IllegalArgumentException(
          "Could not perform anchored concat because we are already at the end of the root ${visualize(base)}")
    }
    var firstChange = 0
    while (firstChange < maxChange) {
      if (base[endIndex + firstChange] != other[firstChange]) {
        break
      }
      ++firstChange
    }
    return IllegalArgumentException(
        """
								This ends with '${visualize(base.subSequence(endIndex, endIndex + firstChange + 1))}'
								cannot concat  '${visualize(other.subSequence(firstChange, firstChange + 1))}
								"""
            .trimIndent())
  }
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
  fun startsWith(prefix: CharSequence): Boolean {
    if (length < prefix.length) {
      return false
    }
    for (i in 0 until prefix.length) {
      if (get(i) != prefix[i]) {
        return false
      }
    }
    return true
  }
  fun endsWith(suffix: CharSequence): Boolean {
    if (length < suffix.length) {
      return false
    }
    val offset = length - suffix.length
    for (i in 0 until suffix.length) {
      if (get(i + offset) != suffix[i]) {
        return false
      }
    }
    return true
  }
  fun indexOf(lookingFor: String, startOffset: Int = 0): Int {
    val result =
        if (base is String) base.indexOf(lookingFor, startIndex + startOffset)
        else (base as StringBuilder).indexOf(lookingFor, startIndex + startOffset)
    return if (result == -1 || result >= endIndex) -1 else result - startIndex
  }
  fun indexOf(lookingFor: Char, startOffset: Int = 0): Int {
    val result =
        if (base is String) base.indexOf(lookingFor, startIndex + startOffset)
        else (base as StringBuilder).indexOf(lookingFor, startIndex + startOffset)
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
    var lineEnd = indexOf('\n', lineStart)
    return if (lineEnd == -1) {
      Slice(base, startIndex + lineStart, endIndex)
    } else {
      Slice(base, startIndex + lineStart, startIndex + lineEnd)
    }
  }

  /**
   * Returns a Slice which represents everything from the start of this string until `lookingFor` is
   * found. If the string is never found, returns this.
   */
  fun until(lookingFor: String): Slice {
    val idx = indexOf(lookingFor)
    return if (idx == -1) this else subSequence(0, idx)
  }

  /**
   * Asserts that the other string was generated from a call to [.until], and then returns a new
   * Slice representing everything after that.
   */
  fun after(other: Slice): Slice {
    if (other.isEmpty()) {
      return this
    }
    require(other.base === base && other.startIndex == startIndex && other.endIndex <= endIndex) {
      "'${visualize(other)}' was not generated by `until` on '${visualize(this)}'"
    }
    return Slice(base, other.endIndex, endIndex)
  }

  /**
   * Returns the line number of the start of this string. Throws an exception if this isn't based on
   * a string any longer, because non-contiguous StringPools have been concatenated.
   */
  fun baseLineNumberStart(): Int {
    return baseLineNumberOfOffset(startIndex)
  }

  /**
   * Returns the line number of the end of this string. Throws an exception if this isn't based on a
   * string any longer, because non-contiguous Slices have been concatenated.
   */
  fun baseLineNumberEnd(): Int {
    return baseLineNumberOfOffset(endIndex)
  }
  private fun baseLineNumberOfOffset(idx: Int): Int {
    assertStringBased()
    var lineNumber = 1
    for (i in 0 until base.length) {
      if (base[i] == '\n') {
        ++lineNumber
      }
    }
    return lineNumber
  }
  private fun assertStringBased() {
    check(base is String) {
      "When you call concat on non-contiguous parts, you lose the connection to the original String."
    }
  }
  override fun equals(anObject: Any?): Boolean {
    if (this === anObject) {
      return true
    } else if (anObject is Slice) {
      return sameAs(anObject)
    }
    return false
  }
  override fun hashCode(): Int {
    var h = 0
    for (i in indices) {
      h = 31 * h + get(i).code
    }
    return h
  }
  fun endsAtSamePlace(other: Slice): Boolean {
    check(base === other.base)
    return endIndex == other.endIndex
  }

  /** Returns the underlying string with this slice replaced by the given string. */
  fun replaceSelfWith(s: String): String {
    check(base is String)
    val deltaLength = s.length - length
    val builder = StringBuilder(base.length + deltaLength)
    builder.appendRange(base, 0, startIndex)
    builder.append(s)
    builder.appendRange(base, endIndex, base.length)
    return builder.toString()
  }

  companion object {
    @JvmStatic
    fun of(base: String, startIndex: Int = 0, endIndex: Int = base.length): Slice {
      return Slice(base, startIndex, endIndex)
    }
    fun concatAll(vararg poolStringsOrStrings: CharSequence): Slice {
      if (poolStringsOrStrings.isEmpty()) {
        return empty()
      }
      var total = asPool(poolStringsOrStrings[0])
      for (i in 1 until poolStringsOrStrings.size) {
        val next = poolStringsOrStrings[i]
        total = if (next is String) total.concat(next) else total.concat(next as Slice)
      }
      return total
    }
    private fun visualize(input: CharSequence): String {
      return input
          .toString()
          .replace("\n", "␊")
          .replace("\r", "␍")
          .replace(" ", "·")
          .replace("\t", "»")
    }
    private fun asPool(sequence: CharSequence): Slice {
      return if (sequence is Slice) sequence else of(sequence as String)
    }

    /** Returns the empty Slice. */
    @JvmStatic
    fun empty(): Slice {
      return Slice("", 0, 0)
    }
  }
}
