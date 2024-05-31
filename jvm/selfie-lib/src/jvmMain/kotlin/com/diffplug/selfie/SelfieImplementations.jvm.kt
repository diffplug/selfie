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
  actual fun toBe(expected: String): String
  actual fun toBe_TODO(): String
  fun toBe_TODO(unusedArg: Any?): String = toBe_TODO()

  // the methods below are aliases for multiline strings for JAVA_PRE15
  fun toBe_TODO(
      expected: String,
      expectedLine2: String,
      vararg expectedOtherLines: String
  ): String = toBe_TODO()
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
