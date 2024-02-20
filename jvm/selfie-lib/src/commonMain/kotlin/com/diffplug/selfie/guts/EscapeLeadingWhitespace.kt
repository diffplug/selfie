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

enum class EscapeLeadingWhitespace {
  ALWAYS,
  NEVER,
  ONLY_ON_SPACE,
  ONLY_ON_TAB;

  companion object {
    private val leadingWhitespaceRegex = "^\\s+".toRegex()
    private val MIXED = 'm'
    fun appropriateFor(fileContent: String): EscapeLeadingWhitespace {
      val commonWhitespace =
          fileContent
              .lineSequence()
              .mapNotNull { line ->
                leadingWhitespaceRegex.find(line)?.value?.let { whitespace ->
                  if (whitespace.isEmpty()) null
                  else if (whitespace.all { it == ' ' }) ' '
                  else if (whitespace.all { it == '\t' }) '\t' else MIXED
                }
              }
              .reduceOrNull { a, b -> if (a == b) a else MIXED }
      return if (commonWhitespace == ' ') ONLY_ON_TAB
      else if (commonWhitespace == '\t') ONLY_ON_SPACE else ALWAYS
    }
  }
}
