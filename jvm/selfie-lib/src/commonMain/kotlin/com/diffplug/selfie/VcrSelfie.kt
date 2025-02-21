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
    var count = 0
    val sequence = mutableListOf<Pair<String, SnapshotValue>>()
  }
  private val state: State

  init {
    val canWrite = Selfie.system.mode.canWrite(isTodo = false, call, Selfie.system)
    state = State(readMode = !canWrite)
    if (state.readMode) {
      val snapshot =
          disk.readDisk(sub, call)
              ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
      var idx = 1
      for ((key, value) in snapshot.facets) {
        check(key.startsWith(OPEN))
        val nextClose = key.indexOf(CLOSE)
        check(nextClose != -1)
        val num = key.substring(OPEN.length, nextClose).toInt()
        check(num == idx)
        ++idx
        val keyAfterNum = key.substring(nextClose + 1)
        state.sequence.add(keyAfterNum to value)
      }
    }
  }
  override fun close() {
    if (state.readMode) {
      if (state.sequence.size != state.count) {
        throw Selfie.system.fs.assertFailed(
            Selfie.system.mode.msgVcrKeyUnread(state.sequence.size, state.count))
      }
    } else {
      var snapshot = Snapshot.of("")
      var idx = 1
      for ((key, value) in state.sequence) {
        snapshot = snapshot.plusFacet("$OPEN$idx$CLOSE$key", value)
      }
      disk.writeDisk(snapshot, sub, call)
    }
  }
  private fun nextValue(key: String): SnapshotValue {
    val mode = Selfie.system.mode
    val fs = Selfie.system.fs
    if (state.sequence.size <= state.count) {
      throw fs.assertFailed(mode.msgVcrKeyUnderflow(state.sequence.size))
    }
    val expected = state.sequence[state.count++]
    if (expected.first != key) {
      throw fs.assertFailed(
          mode.msgVcrKeyMismatch("$sub[$OPEN${state.count}$CLOSE]", expected.first, key),
          expected.first,
          key)
    }
    return expected.second
  }
  fun <V> next(key: String, roundtripValue: Roundtrip<V, String>, value: Cacheable<V>): V {
    if (state.readMode) {
      return roundtripValue.parse(nextValue(key).valueString())
    } else {
      val value = value.get()
      state.sequence.add(key to SnapshotValue.of(roundtripValue.serialize(value)))
      return value
    }
  }
  fun next(key: String, value: Cacheable<String>): String = next(key, Roundtrip.identity(), value)
  inline fun <reified V> nextJson(key: String, value: Cacheable<V>): V =
      next(key, RoundtripJson.of<V>(), value)
  fun <V> nextBinary(key: String, roundtripValue: Roundtrip<V, ByteArray>, value: Cacheable<V>): V {
    if (state.readMode) {
      return roundtripValue.parse(nextValue(key).valueBinary())
    } else {
      val value = value.get()
      state.sequence.add(key to SnapshotValue.of(roundtripValue.serialize(value)))
      return value
    }
  }
  fun <V> nextBinary(key: String, value: Cacheable<ByteArray>): ByteArray =
      nextBinary(key, Roundtrip.identity(), value)
}
