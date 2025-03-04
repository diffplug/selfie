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
import com.diffplug.selfie.guts.atomic
import com.diffplug.selfie.guts.recordCall
import com.diffplug.selfie.guts.reentrantLock
import com.diffplug.selfie.guts.withLock

private const val OPEN = "«"
private const val CLOSE = "»"

class VcrSelfie
internal constructor(
    private val sub: String,
    private val disk: DiskStorage,
) : AutoCloseable {
  private val call: CallStack = recordCall(false)
  private val state: State

  internal sealed class State {
    class Read(val frames: List<Pair<String, SnapshotValue>>) : State() {
      fun currentFrameThenAdvance(): Int = cf.getAndUpdate { it + 1 }
      fun framesReadSoFar(): Int = cf.get()
      private val cf = atomic(0)
    }

    class Write : State() {
      private val lock = reentrantLock()
      private var frames: MutableList<Map.Entry<String, SnapshotValue>>? =
          mutableListOf<Map.Entry<String, SnapshotValue>>()
      fun add(key: String, value: SnapshotValue) {
        lock.withLock {
          frames?.apply {
            val idx = size + 1
            add(entry("$OPEN$idx$CLOSE$key", value))
          } ?: throw IllegalStateException("This VCR was already closed.")
        }
      }
      fun closeAndGetSnapshot(): Snapshot =
          Snapshot.ofEntries(
              lock.withLock {
                val frozen = frames ?: throw IllegalStateException("This VCR was already closed.")
                frames = null
                frozen
              })
    }
  }

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
      if (state.frames.size != state.framesReadSoFar()) {
        throw Selfie.system.fs.assertFailed(
            Selfie.system.mode.msgVcrUnread(state.frames.size, state.framesReadSoFar()))
      }
    } else {
      disk.writeDisk((state as State.Write).closeAndGetSnapshot(), sub, call)
    }
  }
  private fun nextFrameValue(state: State.Read, key: String): SnapshotValue {
    val mode = Selfie.system.mode
    val fs = Selfie.system.fs
    val currentFrame = state.currentFrameThenAdvance()
    if (state.frames.size <= currentFrame) {
      throw fs.assertFailed(mode.msgVcrUnderflow(state.frames.size))
    }
    val expected = state.frames[currentFrame]
    if (expected.first != key) {
      throw fs.assertFailed(
          mode.msgVcrMismatch("$sub[$OPEN${currentFrame}$CLOSE]", expected.first, key),
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
