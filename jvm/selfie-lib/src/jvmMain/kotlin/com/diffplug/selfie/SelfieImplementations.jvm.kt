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
package com.diffplug.selfie

actual interface StringFacet : FluentFacet {
  /** Expects this string to be equal to the expected string. */
  actual fun toBe(expected: String): String

  /** Marks that the expected value should be written when the test executes. */
  actual fun toBe_TODO(): String

  /** Alias for [toBe_TODO], the argument is ignored. */
  fun toBe_TODO(unusedArg: Any?): String = toBe_TODO()

  /** Alias for [toBe_TODO], the arguments are ignored. */
  fun toBe_TODO(
      expected: String,
      expectedLine2: String,
      vararg expectedOtherLines: String
  ): String = toBe_TODO()

  /** Expects this string to be equal to the value of all its arguments concatenated by newlines. */
  fun toBe(expected: String, expectedLine2: String, vararg expectedOtherLines: String): String {
    val buffer = StringBuilder()
    buffer.append(expected)
    buffer.append("\n")
    buffer.append(expectedLine2)
    for (line in expectedOtherLines) {
      buffer.append("\n")
      buffer.append(line)
    }
    return buffer.toString()
  }
}
