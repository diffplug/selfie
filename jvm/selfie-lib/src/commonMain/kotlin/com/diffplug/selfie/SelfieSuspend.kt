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

object SelfieSuspend {
  private suspend fun disk() = Selfie.system.diskCoroutine()
  suspend fun <T> expectSelfie(actual: T, camera: Camera<T>) = expectSelfie(camera.snapshot(actual))
  suspend fun expectSelfie(actual: String) = expectSelfie(Snapshot.of(actual))
  suspend fun expectSelfie(actual: ByteArray) = expectSelfie(Snapshot.of(actual))
  suspend fun expectSelfie(actual: Snapshot) = Selfie.DiskSelfie(actual, disk())
  suspend fun preserveSelfiesOnDisk(vararg subsToKeep: String) {
    val disk = disk()
    if (subsToKeep.isEmpty()) {
      disk.keep(null)
    } else {
      subsToKeep.forEach { disk.keep(it) }
    }
  }
  suspend fun later() = Later(disk())
}
