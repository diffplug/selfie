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

import java.io.ByteArrayOutputStream
import java.io.ObjectOutputStream
import java.io.Serializable
fun <T : Serializable> Selfie.cacheSelfieBinarySerializable(
    toCache: Cacheable<T>
): CacheSelfieBinary<T> =
    cacheSelfieBinary(SerializableRoundtrip as Roundtrip<T, ByteArray>, toCache)

internal object SerializableRoundtrip : Roundtrip<Serializable, ByteArray> {
  override fun serialize(value: Serializable): ByteArray {
    val output = ByteArrayOutputStream()
    ObjectOutputStream(output).use { it.writeObject(value) }
    return output.toByteArray()
  }
  override fun parse(serialized: ByteArray): Serializable {
    return java.io.ObjectInputStream(serialized.inputStream()).use {
      it.readObject() as Serializable
    }
  }
}
