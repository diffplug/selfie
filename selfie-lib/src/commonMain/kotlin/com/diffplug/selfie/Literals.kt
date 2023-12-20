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

object LiteralInt : LiteralFormat<Int> {
  override fun encode(value: Int, language: Language): String {
    // TODO: 1000000 is hard to read, 1_000_000 is much much better
    return value.toString()
  }
  override fun parse(str: String, language: Language): Int {
    return str.replace("_", "").toInt()
  }
}

object LiteralString : LiteralFormat<String> {
  override fun encode(value: String, language: Language): String {
    if (!value.contains("\n")) {
      // TODO: replace \t, maybe others...
      return "\"" + value.replace("\"", "\\\"") + "\""
    } else {
      // TODO: test! It's okay to assume Java 15+ for now
      return "\"\"\"\n" + value + "\"\"\""
    }
  }
  override fun parse(str: String, language: Language): String {
    TODO()
  }
}
