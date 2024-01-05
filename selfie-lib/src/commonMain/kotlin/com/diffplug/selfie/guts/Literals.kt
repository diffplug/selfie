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

import kotlin.math.abs

enum class Language {
  JAVA,
  JAVA_PRE15,
  KOTLIN,
  GROOVY,
  SCALA,
  CLOJURE;

  companion object {
    fun fromFilename(filename: String): Language {
      return when (filename.substringAfterLast('.')) {
        "java" -> JAVA_PRE15 // TODO: detect JRE and use JAVA if JVM >= 15
        "kt" -> KOTLIN
        "groovy",
        "gvy",
        "gy" -> GROOVY
        "scala",
        "sc" -> SCALA
        "clj",
        "cljs" -> CLOJURE
        else -> throw IllegalArgumentException("Unknown language for file $filename")
      }
    }
  }
}

class LiteralValue<T : Any>(val expected: T?, val actual: T, val format: LiteralFormat<T>)

interface LiteralFormat<T : Any> {
  fun encode(value: T, language: Language): String
  fun parse(str: String, language: Language): T
}

private const val MAX_RAW_NUMBER = 1000
private const val PADDING_SIZE = MAX_RAW_NUMBER.toString().length - 1
private fun encodeUnderscores(
    buffer: StringBuilder,
    value: Long,
    language: Language
): StringBuilder {
  return if (value >= MAX_RAW_NUMBER) {
    val mod = value % MAX_RAW_NUMBER
    val leftPadding = PADDING_SIZE - mod.toString().length
    encodeUnderscores(buffer, value / MAX_RAW_NUMBER, language)
    buffer.append("_")
    for (i in leftPadding downTo 1) {
      buffer.append('0')
    }
    buffer.append(mod)
    buffer
  } else if (value < 0) {
    buffer.append('-')
    encodeUnderscores(buffer, abs(value), language)
  } else {
    buffer.append(value)
  }
}

internal object LiteralInt : LiteralFormat<Int> {
  override fun encode(value: Int, language: Language): String {
    return encodeUnderscores(StringBuilder(), value.toLong(), language).toString()
  }
  override fun parse(str: String, language: Language): Int {
    return str.replace("_", "").toInt()
  }
}

internal object LiteralLong : LiteralFormat<Long> {
  override fun encode(value: Long, language: Language): String {
    val buffer = encodeUnderscores(StringBuilder(), value.toLong(), language)
    if (language != Language.CLOJURE) {
      buffer.append('L')
    }
    return buffer.toString()
  }
  override fun parse(str: String, language: Language): Long {
    var longStr = str.replace("_", "")
    if (longStr.endsWith("L")) {
      longStr = longStr.substring(0, longStr.length - 1)
    }
    return longStr.toLong()
  }
}

internal object LiteralString : LiteralFormat<String> {
  override fun encode(value: String, language: Language): String {
    return singleLineJavaToSource(value)
  }
  override fun parse(str: String, language: Language): String {
    return singleLineJavaFromSource(str)
  }
  private fun singleLineJavaToSource(value: String): String {
    val source = StringBuilder()
    source.append("\"")
    for (char in value) {
      when (char) {
        '\b' -> source.append("\\b")
        '\n' -> source.append("\\n")
        '\r' -> source.append("\\r")
        '\t' -> source.append("\\t")
        '\"' -> source.append("\\\"")
        '\\' -> source.append("\\\\")
        else ->
            if (isControlChar(char)) {
              source.append("\\u")
              source.append(char.code.toString(16).padStart(4, '0'))
            } else {
              source.append(char)
            }
      }
    }
    source.append("\"")
    return source.toString()
  }
  private fun isControlChar(c: Char): Boolean {
    return c in '\u0000'..'\u001F' || c == '\u007F'
  }
  private fun singleLineJavaFromSource(source: String): String {
    val value = StringBuilder()
    var i = 0
    while (i < source.length) {
      var c = source[i]
      if (c == '\\') {
        i++
        c = source[i]
        when (c) {
          'b' -> value.append('\b')
          'n' -> value.append('\n')
          'r' -> value.append('\r')
          't' -> value.append('\t')
          '\"' -> value.append('\"')
          '\\' -> value.append('\\')
          'u' -> {
            val code = source.substring(i + 1, i + 5).toInt(16)
            value.append(code.toChar())
            i += 4
          }
        }
      } else if (c != '\"') {
        value.append(c)
      }
      i++
    }
    return value.toString()
  }
}

internal object LiteralBoolean : LiteralFormat<Boolean> {
  override fun encode(value: Boolean, language: Language): String {
    return value.toString()
  }
  override fun parse(str: String, language: Language): Boolean {
    return str.toBooleanStrict()
  }
}

internal object DiskSnapshotTodo : LiteralFormat<Unit> {
  override fun encode(value: Unit, language: Language) = throw UnsupportedOperationException()
  override fun parse(str: String, language: Language) = throw UnsupportedOperationException()
  fun createLiteral() = LiteralValue(null, Unit, DiskSnapshotTodo)
}