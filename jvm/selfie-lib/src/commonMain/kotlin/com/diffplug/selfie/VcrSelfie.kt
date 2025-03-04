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

  internal sealed class State {
    class Read(val frames: List<Pair<String, SnapshotValue>>) : State() {
      var currentFrame = 0
    }

    class Write : State() {
      private val frames = mutableListOf<Pair<String, SnapshotValue>>()
      fun add(key: String, value: SnapshotValue) {
        frames.add(key to value)
      }
      fun toSnapshot(): Snapshot {
        var snapshot = Snapshot.of("")
        var idx = 1
        for ((key, value) in frames) {
          snapshot = snapshot.plusFacet("$OPEN$idx$CLOSE$key", value)
          ++idx
        }
        return snapshot
      }
    }
  }
  private val state: State

  init {
    val canWrite = Selfie.system.mode.canWrite(isTodo = false, call, Selfie.system)
    if (canWrite) {
      val snapshot =
          disk.readDisk(sub, call)
              ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgVcrSnapshotNotFound())
      var idx = 1
      val frames = mutableListOf<Pair<String, SnapshotValue>>()
      for ((key, value) in snapshot.facets) {
        check(key.startsWith(OPEN))
        val nextClose = key.indexOf(CLOSE)
        check(nextClose != -1)
        val num = key.substring(OPEN.length, nextClose).toInt()
        check(num == idx) { "expected $idx in $key" }
        ++idx
        val keyAfterNum = key.substring(nextClose + 1)
        frames.add(keyAfterNum to value)
      }
      state = State.Read(frames)
    } else {
      state = State.Write()
    }
  }
  override fun close() {
    if (state is State.Read) {
      if (state.frames.size != state.currentFrame) {
        throw Selfie.system.fs.assertFailed(
            Selfie.system.mode.msgVcrUnread(state.frames.size, state.currentFrame))
      }
    } else {
      disk.writeDisk((state as State.Write).toSnapshot(), sub, call)
    }
  }
  private fun nextFrameValue(state: State.Read, key: String): SnapshotValue {
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
    if (state is State.Read) {
      return roundtripValue.parse(nextFrameValue(state, key).valueString())
    } else {
      val value = value.get()
      (state as State.Write).add(key, SnapshotValue.of(roundtripValue.serialize(value)))
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
    if (state is State.Read) {
      return roundtripValue.parse(nextFrameValue(state, key).valueBinary())
    } else {
      val value = value.get()
      (state as State.Write).add(key, SnapshotValue.of(roundtripValue.serialize(value)))
      return value
    }
  }
  fun <V> nextFrameBinary(key: String, value: Cacheable<ByteArray>): ByteArray =
      nextFrameBinary(key, Roundtrip.identity(), value)
}
