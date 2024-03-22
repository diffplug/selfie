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
import com.diffplug.selfie.Mode
import com.diffplug.selfie.Roundtrip
import com.diffplug.selfie.RoundtripJson
import com.diffplug.selfie.Selfie
import com.diffplug.selfie.SerializableRoundtrip
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.StringSelfie
import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.CoroutineDiskStorage
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.TodoStub
import com.diffplug.selfie.guts.recordCall
import java.io.Serializable
import kotlin.coroutines.coroutineContext
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Whenever Selfie is called from within a coroutine, you should use
 * `com.diffplug.selfie.coroutines` instead of `com.diffplug.selfie.Selfie`. If you want more
 * details, see the [threading details](http://localhost:3000/jvm/kotest#threading-details).
 */
private suspend fun disk(): DiskStorage =
    coroutineContext[CoroutineDiskStorage]?.disk ?: DiskStorageError

private const val WRONG_COROUTINE =
    """No Kotest test is in progress on this coroutine.
If this is a Kotest test, make sure you added `SelfieExtension` to your `AbstractProjectConfig`:
  +class MyProjectConfig : AbstractProjectConfig() {
  +  override fun extensions() = listOf(SelfieExtension(this))
  +}
If this is a JUnit test, make the following change:
  -import com.diffplug.selfie.coroutines.expectSelfie
  +import com.diffplug.selfie.Selfie.expectSelfie
For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines"""

private object DiskStorageError : DiskStorage {
  override fun readDisk(sub: String, call: CallStack) = throw IllegalStateException(WRONG_COROUTINE)
  override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) =
      throw IllegalStateException(WRONG_COROUTINE)
  override fun keep(subOrKeepAll: String?) = throw IllegalStateException(WRONG_COROUTINE)
}
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
suspend fun cacheSelfie(toCache: suspend () -> String) = cacheSelfie(Roundtrip.identity(), toCache)
suspend fun <T> cacheSelfie(roundtrip: Roundtrip<T, String>, toCache: suspend () -> T) =
    CacheSelfieSuspend(disk(), roundtrip, toCache)
/**
 * Memoizes any type which is marked with `@kotlinx.serialization.Serializable` as pretty-printed
 * json.
 */
suspend inline fun <reified T> cacheSelfieJson(noinline toCache: suspend () -> T) =
    cacheSelfie(RoundtripJson.of<T>(), toCache)
suspend fun cacheSelfieBinary(toCache: suspend () -> ByteArray) =
    cacheSelfieBinary(Roundtrip.identity(), toCache)
suspend fun <T> cacheSelfieBinary(roundtrip: Roundtrip<T, ByteArray>, toCache: suspend () -> T) =
    CacheSelfieBinarySuspend(disk(), roundtrip, toCache)

class CacheSelfieSuspend<T>(
    private val disk: DiskStorage,
    private val roundtrip: Roundtrip<T, String>,
    private val generator: suspend () -> T
) {
  suspend fun toMatchDisk(sub: String = ""): T {
    return toMatchDiskImpl(sub, false)
  }
  suspend fun toMatchDisk_TODO(sub: String = ""): T {
    return toMatchDiskImpl(sub, true)
  }
  private suspend fun toMatchDiskImpl(sub: String, isTodo: Boolean): T {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(isTodo, call, Selfie.system)) {
      val actual = generator()
      disk.writeDisk(Snapshot.of(roundtrip.serialize(actual)), sub, call)
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toMatchDisk.createLiteral(), call)
      }
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed(
            "Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
      } else {
        val snapshot =
            disk.readDisk(sub, call)
                ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
        if (snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
          throw Selfie.system.fs.assertFailed(
              "Expected a string subject with no facets, got ${snapshot}")
        }
        return roundtrip.parse(snapshot.subject.valueString())
      }
    }
  }
  suspend fun toBe_TODO(unusedArg: Any? = null): T {
    return toBeImpl(null)
  }
  suspend fun toBe(expected: String): T {
    return toBeImpl(expected)
  }
  private suspend fun toBeImpl(snapshot: String?): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(snapshot == null, call, Selfie.system)
    if (writable) {
      val actual = generator()
      Selfie.system.writeInline(
          LiteralValue(snapshot, roundtrip.serialize(actual), LiteralString), call)
      return actual
    } else {
      if (snapshot == null) {
        throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        return roundtrip.parse(snapshot)
      }
    }
  }
}

class CacheSelfieBinarySuspend<T>(
    private val disk: DiskStorage,
    private val roundtrip: Roundtrip<T, ByteArray>,
    private val generator: suspend () -> T
) {
  suspend fun toMatchDisk(sub: String = ""): T {
    return toMatchDiskImpl(sub, false)
  }
  suspend fun toMatchDisk_TODO(sub: String = ""): T {
    return toMatchDiskImpl(sub, true)
  }
  private suspend fun toMatchDiskImpl(sub: String, isTodo: Boolean): T {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(isTodo, call, Selfie.system)) {
      val actual = generator()
      disk.writeDisk(Snapshot.of(roundtrip.serialize(actual)), sub, call)
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toMatchDisk.createLiteral(), call)
      }
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed(
            "Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
      } else {
        val snapshot =
            disk.readDisk(sub, call)
                ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
        if (!snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
          throw Selfie.system.fs.assertFailed(
              "Expected a binary subject with no facets, got ${snapshot}")
        }
        return roundtrip.parse(snapshot.subject.valueBinary())
      }
    }
  }
  private fun resolvePath(subpath: String) = Selfie.system.layout.rootFolder.resolveFile(subpath)
  suspend fun toBeFile_TODO(subpath: String): T {
    return toBeFileImpl(subpath, true)
  }
  suspend fun toBeFile(subpath: String): T {
    return toBeFileImpl(subpath, false)
  }
  private suspend fun toBeFileImpl(subpath: String, isTodo: Boolean): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(isTodo, call, Selfie.system)
    if (writable) {
      val actual = generator()
      if (isTodo) {
        Selfie.system.writeInline(TodoStub.toBeFile.createLiteral(), call)
      }
      Selfie.system.writeToBeFile(resolvePath(subpath), roundtrip.serialize(actual), call)
      return actual
    } else {
      if (isTodo) {
        throw Selfie.system.fs.assertFailed("Can't call `toBeFile_TODO` in ${Mode.readonly} mode!")
      } else {
        val path = resolvePath(subpath)
        if (!Selfie.system.fs.fileExists(path)) {
          throw Selfie.system.fs.assertFailed(
              Selfie.system.mode.msgSnapshotNotFoundNoSuchFile(path))
        }
        return roundtrip.parse(Selfie.system.fs.fileReadBinary(path))
      }
    }
  }
  suspend fun toBeBase64_TODO(unusedArg: Any? = null): T {
    return toBeBase64Impl(null)
  }
  suspend fun toBeBase64(snapshot: String): T {
    return toBeBase64Impl(snapshot)
  }

  @OptIn(ExperimentalEncodingApi::class)
  private suspend fun toBeBase64Impl(snapshot: String?): T {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(snapshot == null, call, Selfie.system)
    if (writable) {
      val actual = generator()
      val base64 = Base64.Mime.encode(roundtrip.serialize(actual)).replace("\r", "")
      Selfie.system.writeInline(LiteralValue(snapshot, base64, LiteralString), call)
      return actual
    } else {
      if (snapshot == null) {
        throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
      } else {
        return roundtrip.parse(Base64.Mime.decode(snapshot))
      }
    }
  }
}

/** Memoizes any [java.io.Serializable] type as a binary blob. */
suspend fun <T : Serializable> cacheSelfieBinarySerializable(
    toCache: suspend () -> T
): CacheSelfieBinarySuspend<T> =
    cacheSelfieBinary(SerializableRoundtrip as Roundtrip<T, ByteArray>, toCache)
