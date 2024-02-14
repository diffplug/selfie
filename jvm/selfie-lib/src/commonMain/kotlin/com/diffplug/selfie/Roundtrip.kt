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

interface Roundtrip<T, SerializedForm> {
  fun serialize(value: T): SerializedForm
  fun parse(serialized: SerializedForm): T

  companion object {
    fun <T : Any> identity(): Roundtrip<T, T> = IDENTITY as Roundtrip<T, T>
    private val IDENTITY =
        object : Roundtrip<Any, Any> {
          override fun serialize(value: Any): Any = value
          override fun parse(serialized: Any): Any = serialized
        }
  }
}

/** Roundtrips the given type into pretty-printed Json. */
class RoundtripJson<T>(private val strategy: kotlinx.serialization.KSerializer<T>) :
    Roundtrip<T, String> {
  private val json =
      kotlinx.serialization.json.Json {
        prettyPrint = true
        prettyPrintIndent = "  "
      }
  override fun serialize(value: T): String = json.encodeToString(strategy, value)
  override fun parse(serialized: String): T = json.decodeFromString(strategy, serialized)

  companion object {
    inline fun <reified T> of() = RoundtripJson<T>(kotlinx.serialization.serializer())
  }
}
