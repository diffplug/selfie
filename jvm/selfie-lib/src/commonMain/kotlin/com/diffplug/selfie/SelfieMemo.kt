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

import com.diffplug.selfie.guts.DiskSnapshotTodo
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.recordCall
import kotlin.jvm.JvmOverloads

class StringMemo(val disk: DiskStorage, val generator: () -> String) {
  @JvmOverloads
  fun toMatchDisk(sub: String = ""): String {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(false, call, Selfie.system)) {
      val actual = generator()
      disk.writeDisk(Snapshot.of(actual), sub, call)
      return actual
    } else {
      val snapshot =
          disk.readDisk(sub, call)
              ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
      if (snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
        throw Selfie.system.fs.assertFailed(
            "Expected a string subject with no facets, got ${snapshot}")
      }
      return snapshot.subject.valueString()
    }
  }

  @JvmOverloads
  fun toMatchDisk_TODO(sub: String = ""): String {
    val call = recordCall(false)
    if (Selfie.system.mode.canWrite(true, call, Selfie.system)) {
      val actual = generator()
      disk.writeDisk(Snapshot.of(actual), sub, call)
      Selfie.system.writeInline(DiskSnapshotTodo.createLiteral(), call)
      return actual
    } else {
      throw Selfie.system.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
    }
  }

  @JvmOverloads
  fun toBe_TODO(unusedArg: Any? = null): String {
    val call = recordCall(false)
    val writable = Selfie.system.mode.canWrite(true, call, Selfie.system)
    if (writable) {
      val actual = generator()
      Selfie.system.writeInline(LiteralValue(null, actual, LiteralString), call)
      return actual
    } else {
      throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
    }
  }
  fun toBe(expected: String): String = expected
}
