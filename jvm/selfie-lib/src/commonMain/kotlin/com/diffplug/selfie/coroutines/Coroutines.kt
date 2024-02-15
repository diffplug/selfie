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
package com.diffplug.selfie.coroutines

import com.diffplug.selfie.BinarySelfie
import com.diffplug.selfie.Camera
import com.diffplug.selfie.Roundtrip
import com.diffplug.selfie.RoundtripJson
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.StringSelfie
import com.diffplug.selfie.guts.CoroutineDiskStorage
import kotlin.coroutines.coroutineContext

/**
 * Whenever Selfie is called from within a coroutine, you should use
 * `com.diffplug.selfie.coroutines` instead of `com.diffplug.selfie.Selfie`. If you want more
 * details, see the [threading details](http://localhost:3000/jvm/kotest#threading-details).
 */
private suspend fun disk() =
    coroutineContext[CoroutineDiskStorage]?.disk
        ?: throw IllegalStateException(
            """
      No Kotest test is in progress on this coroutine.
      If this is a Kotest test, make sure you added `SelfieExtension` to your `AbstractProjectConfig`:
        +class MyProjectConfig : AbstractProjectConfig() {
        +  override fun extensions() = listOf(SelfieExtension(this))
        +}
      If this is a JUnit test, make the following change:
        -import com.diffplug.selfie.coroutines.expectSelfie
        +import com.diffplug.selfie.Selfie.expectSelfie
      For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines
    """
                .trimIndent())
suspend fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))
suspend fun expectSelfie(actual: String) = expectSelfie(Snapshot.of(actual))
suspend fun expectSelfie(actual: ByteArray) = BinarySelfie(Snapshot.of(actual), disk(), "")
suspend fun expectSelfie(actual: Snapshot) = StringSelfie(actual, disk())
suspend fun preserveSelfiesOnDisk(vararg subsToKeep: String) {
  val disk = disk()
  if (subsToKeep.isEmpty()) {
    disk.keep(null)
  } else {
    subsToKeep.forEach { disk.keep(it) }
  }
}
suspend fun lazySelfie(toMemoize: suspend () -> String) =
    lazySelfie(Roundtrip.identity(), toMemoize)
suspend fun <T> lazySelfie(roundtrip: Roundtrip<T, String>, toMemoize: suspend () -> T) =
    LazySelfieSuspend(disk(), roundtrip, toMemoize)
/**
 * Memoizes any type which is marked with `@kotlinx.serialization.Serializable` as pretty-printed
 * json.
 */
suspend inline fun <reified T> lazySelfieJson(noinline toMemoize: suspend () -> T) =
    lazySelfie(RoundtripJson.of<T>(), toMemoize)
suspend fun lazySelfieBinary(toMemoize: suspend () -> ByteArray) =
    lazySelfieBinary(Roundtrip.identity(), toMemoize)
suspend fun <T> lazySelfieBinary(roundtrip: Roundtrip<T, ByteArray>, toMemoize: suspend () -> T) =
    LazySelfieBinarySuspend(disk(), roundtrip, toMemoize)
