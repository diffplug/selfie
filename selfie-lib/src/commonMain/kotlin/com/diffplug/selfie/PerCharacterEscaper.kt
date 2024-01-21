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

expect class PerCharacterEscaper {
  fun escape(input: String): String
  fun unescape(input: String): String

  companion object {
    /**
     * If your escape policy is `'123`, it means this: <br>
     *
     * ```
     * abc->abc
     * 123->'1'2'3
     * I won't->I won''t
     * ```
     */
    fun selfEscape(escapePolicy: String): PerCharacterEscaper

    /**
     * If your escape policy is `'a1b2c3d`, it means this: <br>
     *
     * ```
     * abc->abc
     * 123->'b'c'd
     * I won't->I won'at
     * ```
     */
    fun specifiedEscape(escapePolicy: String): PerCharacterEscaper
  }
}
