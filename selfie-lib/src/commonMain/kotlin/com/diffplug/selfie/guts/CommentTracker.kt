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
package com.diffplug.selfie.guts

import com.diffplug.selfie.ArrayMap

internal expect class CAS<T> {
  fun get(): T
  fun updateAndGet(update: (T) -> T): T
}

internal expect fun <T> createCas(initial: T): CAS<T>

/**
 * Tracks whether a given file has a comment which allows it to be written to. Thread-safe on
 * multithreaded platforms.
 */
class CommentTracker {
  private enum class WritableComment {
    NO_COMMENT,
    ONCE,
    FOREVER;
    val writable: Boolean
      get() = this != NO_COMMENT
    val needsRemoval: Boolean
      get() = this == ONCE
  }
  private val cache = createCas(ArrayMap.empty<Path, WritableComment>())
  fun pathsWithOnce(): Iterable<Path> =
      cache.get().mapNotNull { if (it.value == WritableComment.ONCE) it.key else null }
  fun hasWritableComment(call: CallStack, layout: SnapshotFileLayout): Boolean {
    val path = layout.sourcePathForCall(call.location) ?: return false
    val comment = cache.get()[path]
    return if (comment != null) {
      comment.writable
    } else {
      val str = layout.fs.fileRead(path)
      // TODO: there is a bug here due to string constants, and non-C file comments
      val newComment =
          if (str.contains("//selfieonce") || str.contains("// selfieonce")) {
            WritableComment.ONCE
          } else if (str.contains("//SELFIEWRITE") || str.contains("// SELFIEWRITE")) {
            WritableComment.FOREVER
          } else {
            WritableComment.NO_COMMENT
          }
      cache.updateAndGet { it.plus(path, newComment) }
      newComment.writable
    }
  }
}
