/*
 * Copyright (C) 2024 DiffPlug
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

internal enum class EscapeLeadingWhitespace {
  ALWAYS,
  NEVER,
  ONLY_ON_SPACE,
  ONLY_ON_TAB;
  fun escapeLine(line: String, space: String, tab: String): String =
      if (line.startsWith(" ")) {
        if (this == ALWAYS || this == ONLY_ON_SPACE) "$space${line.drop(1)}" else line
      } else if (line.startsWith("\t")) {
        if (this == ALWAYS || this == ONLY_ON_TAB) "$tab${line.drop(1)}" else line
      } else line

  companion object {
    private val MIXED = 'm'
    fun appropriateFor(fileContent: String): EscapeLeadingWhitespace {
      val commonWhitespace =
          fileContent
              .lineSequence()
              .mapNotNull { line ->
                val whitespace = line.takeWhile { it.isWhitespace() }
                if (whitespace.isEmpty() || whitespace == " ") null
                else if (whitespace.all { it == ' ' }) ' '
                else if (whitespace.all { it == '\t' }) '\t' else MIXED
              }
              .reduceOrNull { a, b -> if (a == b) a else MIXED }
      return if (commonWhitespace == ' ') ONLY_ON_TAB
      else if (commonWhitespace == '\t') ONLY_ON_SPACE else ALWAYS
    }
  }
}
