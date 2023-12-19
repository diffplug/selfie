/*
 * Copyright (C) 2023 DiffPlug
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

class LiteralValue<T : Any>(val expected: T?, val actual: T, val format: LiteralFormat<T>) {
  fun encodedActual(): String = format.encode(actual)
}

interface LiteralFormat<T : Any> {
  fun encode(value: T): String
  fun parse(str: String): T
}

class IntFormat : LiteralFormat<Int> {
  override fun encode(value: Int): String {
    // TODO: 1000000 is hard to read, 1_000_000 is much much better
    return value.toString()
  }
  override fun parse(str: String): Int {
    return str.replace("_", "").toInt()
  }
}

class StrFormat : LiteralFormat<String> {
  override fun encode(value: String): String {
    if (!value.contains("\n")) {
      // TODO: replace \t, maybe others...
      return "\"" + value.replace("\"", "\\\"") + "\""
    } else {
      // TODO: test! It's okay to assume Java 15+ for now
      return "\"\"\"\n" + value + "\"\"\""
    }
  }
  override fun parse(str: String): String {
    TODO("Harder than it seems!")
  }
}