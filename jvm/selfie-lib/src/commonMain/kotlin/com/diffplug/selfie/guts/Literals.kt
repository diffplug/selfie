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

internal expect fun jreVersion(): Int

enum class Language {
  JAVA,
  JAVA_PRE15,
  KOTLIN,
  GROOVY,
  SCALA;

  companion object {
    fun fromFilename(filename: String): Language {
      return when (filename.substringAfterLast('.')) {
        "java" -> if (jreVersion() < 15) JAVA_PRE15 else JAVA
        "kt" -> KOTLIN
        "groovy",
        "gvy",
        "gy" -> GROOVY
        "scala",
        "sc" -> SCALA
        else -> throw IllegalArgumentException("Unknown language for file $filename")
      }
    }
  }
}

class LiteralValue<T : Any>(val expected: T?, val actual: T, val format: LiteralFormat<T>)

abstract class LiteralFormat<T : Any> {
  internal abstract fun encode(value: T, language: Language): String
  internal abstract fun parse(str: String, language: Language): T
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

internal object LiteralInt : LiteralFormat<Int>() {
  override fun encode(value: Int, language: Language): String {
    return encodeUnderscores(StringBuilder(), value.toLong(), language).toString()
  }
  override fun parse(str: String, language: Language): Int {
    return str.replace("_", "").toInt()
  }
}

internal object LiteralLong : LiteralFormat<Long>() {
  override fun encode(value: Long, language: Language): String {
    val buffer = encodeUnderscores(StringBuilder(), value, language)
    buffer.append('L')
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

private const val TRIPLE_QUOTE = "\"\"\""
private const val KOTLIN_DOLLAR = "\${'\$'}"
private const val KOTLIN_DOLLARQUOTE = "\${'\"'}"

internal object LiteralString : LiteralFormat<String>() {
  override fun encode(value: String, language: Language): String =
      if (value.indexOf('\n') == -1)
          when (language) {
            Language.SCALA, // scala only does $ substitution for s" and f" strings
            Language.JAVA_PRE15,
            Language.GROOVY,
            Language.JAVA -> encodeSingleJava(value)
            Language.KOTLIN -> encodeSingleJavaWithDollars(value)
          }
      else
          when (language) {
            // TODO: support triple-quoted strings in scala
            // https://github.com/diffplug/selfie/issues/106
            Language.SCALA,
            // TODO: support triple-quoted strings in groovy
            // https://github.com/diffplug/selfie/issues/105
            Language.GROOVY,
            Language.JAVA_PRE15 -> encodeSingleJava(value)
            Language.JAVA -> encodeMultiJava(value)
            Language.KOTLIN -> encodeMultiKotlin(value)
          }
  override fun parse(str: String, language: Language): String =
      if (!str.startsWith(TRIPLE_QUOTE))
          when (language) {
            Language.SCALA,
            Language.JAVA_PRE15,
            Language.JAVA -> parseSingleJava(str)
            Language.GROOVY,
            Language.KOTLIN -> parseSingleJavaWithDollars(str)
          }
      else
          when (language) {
            Language.SCALA ->
                throw UnsupportedOperationException(
                    "Selfie doesn't support triple-quoted strings in Scala, yet - help wanted: https://github.com/diffplug/selfie/issues/106")
            Language.GROOVY ->
                throw UnsupportedOperationException(
                    "Selfie doesn't support triple-quoted strings in Groovy, yet - help wanted: https://github.com/diffplug/selfie/issues/105")
            Language.JAVA_PRE15,
            Language.JAVA -> parseMultiJava(str)
            Language.KOTLIN -> parseMultiKotlin(str)
          }
  fun encodeSingleJava(value: String): String = encodeSingleJavaish(value, false)
  fun encodeSingleJavaWithDollars(value: String) = encodeSingleJavaish(value, true)
  private fun encodeSingleJavaish(value: String, escapeDollars: Boolean): String {
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
        '$' -> if (escapeDollars) source.append(KOTLIN_DOLLAR) else source.append('$')
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
  fun parseSingleJava(sourceWithQuotes: String) = parseSingleJavaish(sourceWithQuotes, false)
  fun parseSingleJavaWithDollars(sourceWithQuotes: String) =
      parseSingleJavaish(sourceWithQuotes, true)
  private fun parseSingleJavaish(sourceWithQuotes: String, removeDollars: Boolean): String {
    check(sourceWithQuotes.startsWith('"'))
    check(sourceWithQuotes.endsWith('"'))
    val source = sourceWithQuotes.substring(1, sourceWithQuotes.length - 1)
    val toUnescape = if (removeDollars) inlineDollars(source) else source
    return unescapeJava(toUnescape)
  }
  fun encodeMultiKotlin(arg: String): String {
    val escapeDollars = arg.replace("$", KOTLIN_DOLLAR)
    val escapeTripleQuotes =
        escapeDollars.replace(
            TRIPLE_QUOTE, "$KOTLIN_DOLLARQUOTE$KOTLIN_DOLLARQUOTE$KOTLIN_DOLLARQUOTE")
    val protectWhitespace =
        escapeTripleQuotes.lines().joinToString("\n") { line ->
          val protectTrailingWhitespace =
              if (line.endsWith(" ")) {
                line.dropLast(1) + "\${' '}"
              } else if (line.endsWith("\t")) {
                line.dropLast(1) + "\${'\\t'}"
              } else line
          val protectLeadingWhitespace =
              if (protectTrailingWhitespace.startsWith(" ")) {
                "\${' '}" + protectTrailingWhitespace.drop(1)
              } else if (protectTrailingWhitespace.startsWith("\t")) {
                "\${'\\t'}" + protectTrailingWhitespace.drop(1)
              } else protectTrailingWhitespace
          protectLeadingWhitespace
        }
    return "$TRIPLE_QUOTE$protectWhitespace$TRIPLE_QUOTE"
  }
  fun encodeMultiJava(arg: String): String {
    val escapeBackslashes = arg.replace("\\", "\\\\")
    val escapeTripleQuotes = escapeBackslashes.replace(TRIPLE_QUOTE, "\\\"\\\"\\\"")
    val protectWhitespace =
        escapeTripleQuotes.lines().joinToString("\n") { line ->
          val protectTrailingWhitespace =
              if (line.endsWith(" ")) {
                line.dropLast(1) + "\\s"
              } else if (line.endsWith("\t")) {
                line.dropLast(1) + "\\t"
              } else line
          val protectLeadingWhitespace =
              if (protectTrailingWhitespace.startsWith(" ")) {
                "\\s" + protectTrailingWhitespace.drop(1)
              } else if (protectTrailingWhitespace.startsWith("\t")) {
                "\\t" + protectTrailingWhitespace.drop(1)
              } else protectTrailingWhitespace
          protectLeadingWhitespace
        }
    return "$TRIPLE_QUOTE\n$protectWhitespace$TRIPLE_QUOTE"
  }
  private val charLiteralRegex = """\$\{'(\\?.)'\}""".toRegex()
  private fun inlineDollars(source: String): String {
    if (source.indexOf('$') == -1) {
      return source
    }
    return charLiteralRegex.replace(source) { matchResult ->
      val charLiteral = matchResult.groupValues[1]
      when {
        charLiteral.length == 1 -> charLiteral
        charLiteral.length == 2 && charLiteral[0] == '\\' ->
            when (charLiteral[1]) {
              't' -> "\t"
              'b' -> "\b"
              'n' -> "\n"
              'r' -> "\r"
              '\'' -> "'"
              '\\' -> "\\"
              '$' -> "$"
              else -> charLiteral
            }
        else -> throw IllegalArgumentException("Unknown character literal $charLiteral")
      }
    }
  }
  private fun unescapeJava(source: String): String {
    val firstEscape = source.indexOf('\\')
    if (firstEscape == -1) {
      return source
    }
    val value = StringBuilder()
    value.append(source.substring(0, firstEscape))
    var i = firstEscape
    while (i < source.length) {
      var c = source[i]
      if (c == '\\') {
        i++
        c = source[i]
        when (c) {
          '\"' -> value.append('\"')
          '\\' -> value.append('\\')
          'b' -> value.append('\b')
          'f' -> value.append('\u000c')
          'n' -> value.append('\n')
          'r' -> value.append('\r')
          's' -> value.append(' ')
          't' -> value.append('\t')
          'u' -> {
            val code = source.substring(i + 1, i + 5).toInt(16)
            value.append(code.toChar())
            i += 4
          }
          else -> throw IllegalArgumentException("Unknown escape sequence $c")
        }
      } else {
        value.append(c)
      }
      i++
    }
    return value.toString()
  }
  fun parseMultiJava(sourceWithQuotes: String): String {
    check(sourceWithQuotes.startsWith("$TRIPLE_QUOTE\n"))
    check(sourceWithQuotes.endsWith(TRIPLE_QUOTE))
    val source =
        sourceWithQuotes.substring(
            TRIPLE_QUOTE.length + 1, sourceWithQuotes.length - TRIPLE_QUOTE.length)
    val lines = source.lines()
    val commonPrefix =
        lines
            .mapNotNull { line ->
              if (line.isNotBlank()) line.takeWhile { it.isWhitespace() } else null
            }
            .minOrNull() ?: ""
    return lines.joinToString("\n") { line ->
      if (line.isBlank()) {
        ""
      } else {
        val removedPrefix = if (commonPrefix.isEmpty()) line else line.removePrefix(commonPrefix)
        val removeTrailingWhitespace = removedPrefix.trimEnd()
        val handleEscapeSequences = unescapeJava(removeTrailingWhitespace)
        handleEscapeSequences
      }
    }
  }
  fun parseMultiKotlin(sourceWithQuotes: String): String {
    check(sourceWithQuotes.startsWith(TRIPLE_QUOTE))
    check(sourceWithQuotes.endsWith(TRIPLE_QUOTE))
    val source =
        sourceWithQuotes.substring(
            TRIPLE_QUOTE.length, sourceWithQuotes.length - TRIPLE_QUOTE.length)
    return inlineDollars(source)
  }
}

internal object LiteralBoolean : LiteralFormat<Boolean>() {
  override fun encode(value: Boolean, language: Language): String {
    return value.toString()
  }
  override fun parse(str: String, language: Language): Boolean {
    return str.toBooleanStrict()
  }
}

internal object DiskSnapshotTodo : LiteralFormat<Unit>() {
  override fun encode(value: Unit, language: Language) = throw UnsupportedOperationException()
  override fun parse(str: String, language: Language) = throw UnsupportedOperationException()
  fun createLiteral() = LiteralValue(null, Unit, DiskSnapshotTodo)
}

internal object ToBeFileTodo : LiteralFormat<Unit>() {
  override fun encode(value: Unit, language: Language) = throw UnsupportedOperationException()
  override fun parse(str: String, language: Language) = throw UnsupportedOperationException()
  fun createLiteral() = LiteralValue(null, Unit, ToBeFileTodo)
}
