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

import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.TodoStub
import com.diffplug.selfie.guts.recordCall

class MemoString<T>(
    private val disk: DiskStorage,
    private val roundtrip: Roundtrip<T, String>,
    private val generator: () -> T
) {
  fun toMatchDisk(sub: String = ""): T {
    return toMatchDiskImpl(sub, false)
  }
  fun toMatchDisk_TODO(sub: String = ""): T {
    return toMatchDiskImpl(sub, true)
  }
  private fun toMatchDiskImpl(sub: String, isTodo: Boolean): T {
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
  fun toBe_TODO(unusedArg: Any? = null): T {
    return toBeImpl(null)
  }
  fun toBe(expected: String): T {
    return toBeImpl(expected)
  }
  private fun toBeImpl(snapshot: String?): T {
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
