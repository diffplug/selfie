/*
 * Copyright (C) 2025 DiffPlug
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

import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.recordCall

private const val OPEN = "«"
private const val CLOSE = "»"

class VcrSelfie
internal constructor(
    private val sub: String,
    private val call: CallStack,
    private val disk: DiskStorage,
) : AutoCloseable {
  class TestLocator internal constructor(private val sub: String, private val disk: DiskStorage) {
    private val call = recordCall(false)
    fun createVcr() = VcrSelfie(sub, call, disk)
  }

  private class State(val readMode: Boolean) {
    var currentFrame = 0
    val frames = mutableListOf<Pair<String, SnapshotValue>>()
  }
  private val state: State

  init {
    val canWrite = Selfie.system.mode.canWrite(isTodo = false, call, Selfie.system)
    state = State(readMode = !canWrite)
    if (state.readMode) {
      val snapshot =
          disk.readDisk(sub, call)
              ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgVcrSnapshotNotFound())
      var idx = 1
      for ((key, value) in snapshot.facets) {
        check(key.startsWith(OPEN))
        val nextClose = key.indexOf(CLOSE)
        check(nextClose != -1)
        val num = key.substring(OPEN.length, nextClose).toInt()
        check(num == idx) { "expected $idx in $key" }
        ++idx
        val keyAfterNum = key.substring(nextClose + 1)
        state.frames.add(keyAfterNum to value)
      }
    }
  }
  override fun close() {
    if (state.readMode) {
      if (state.frames.size != state.currentFrame) {
        throw Selfie.system.fs.assertFailed(
            Selfie.system.mode.msgVcrUnread(state.frames.size, state.currentFrame))
      }
    } else {
      var snapshot = Snapshot.of("")
      var idx = 1
      for ((key, value) in state.frames) {
        snapshot = snapshot.plusFacet("$OPEN$idx$CLOSE$key", value)
        ++idx
      }
      disk.writeDisk(snapshot, sub, call)
    }
  }
  private fun nextFrameValue(key: String): SnapshotValue {
    val mode = Selfie.system.mode
    val fs = Selfie.system.fs
    if (state.frames.size <= state.currentFrame) {
      throw fs.assertFailed(mode.msgVcrUnderflow(state.frames.size))
    }
    val expected = state.frames[state.currentFrame++]
    if (expected.first != key) {
      throw fs.assertFailed(
          mode.msgVcrMismatch("$sub[$OPEN${state.currentFrame}$CLOSE]", expected.first, key),
          expected.first,
          key)
    }
    return expected.second
  }
  fun <V> nextFrame(key: String, roundtripValue: Roundtrip<V, String>, value: Cacheable<V>): V {
    if (state.readMode) {
      return roundtripValue.parse(nextFrameValue(key).valueString())
    } else {
      val value = value.get()
      state.frames.add(key to SnapshotValue.of(roundtripValue.serialize(value)))
      return value
    }
  }
  fun nextFrame(key: String, value: Cacheable<String>): String =
      nextFrame(key, Roundtrip.identity(), value)
  inline fun <reified V> nextFrameJson(key: String, value: Cacheable<V>): V =
      nextFrame(key, RoundtripJson.of<V>(), value)
  fun <V> nextFrameBinary(
      key: String,
      roundtripValue: Roundtrip<V, ByteArray>,
      value: Cacheable<V>
  ): V {
    if (state.readMode) {
      return roundtripValue.parse(nextFrameValue(key).valueBinary())
    } else {
      val value = value.get()
      state.frames.add(key to SnapshotValue.of(roundtripValue.serialize(value)))
      return value
    }
  }
  fun <V> nextFrameBinary(key: String, value: Cacheable<ByteArray>): ByteArray =
      nextFrameBinary(key, Roundtrip.identity(), value)
}
