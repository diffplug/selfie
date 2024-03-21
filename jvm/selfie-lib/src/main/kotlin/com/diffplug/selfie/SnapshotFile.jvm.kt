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

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.LineNumberReader
import java.io.Reader
import java.io.StringReader
import java.nio.CharBuffer
import java.nio.charset.StandardCharsets

actual class LineReader(reader: Reader) {
  private val reader = LineTerminatorAware(LineTerminatorReader(reader))

  actual companion object {
    actual fun forString(content: String) = LineReader(StringReader(content))
    actual fun forBinary(content: ByteArray) =
        LineReader(InputStreamReader(content.inputStream(), StandardCharsets.UTF_8))
  }
  actual fun getLineNumber(): Int = reader.lineNumber
  actual fun readLine(): String? = reader.readLine()
  actual fun unixNewlines(): Boolean = reader.lineTerminator.unixNewlines()
}

/**
 * Keep track of carriage return char to figure it out if we need unix new line or not. The first
 * line is kept in memory until we require the next line.
 */
private open class LineTerminatorAware(val lineTerminator: LineTerminatorReader) :
    LineNumberReader(lineTerminator) {
  /** First line is initialized as soon as possible. */
  private var firstLine: String? = super.readLine()
  override fun readLine(): String? {
    if (this.firstLine != null) {
      val result = this.firstLine
      this.firstLine = null
      return result
    }
    return super.readLine()
  }
}

/**
 * Override all read operations to find the carriage return. We want to keep lazy/incremental reads.
 */
private class LineTerminatorReader(reader: Reader) : BufferedReader(reader) {
  private val CR: Int = '\r'.code
  private var unixNewlines = true
  override fun read(cbuf: CharArray): Int {
    val result = super.read(cbuf)
    unixNewlines = cbuf.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(target: CharBuffer): Int {
    val result = super.read(target)
    unixNewlines = target.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(cbuf: CharArray, off: Int, len: Int): Int {
    val result = super.read(cbuf, off, len)
    unixNewlines = cbuf.indexOf(CR.toChar()) == -1
    return result
  }
  override fun read(): Int {
    val ch = super.read()
    if (ch == CR) {
      unixNewlines = false
    }
    return ch
  }
  fun unixNewlines(): Boolean {
    return unixNewlines
  }
}
