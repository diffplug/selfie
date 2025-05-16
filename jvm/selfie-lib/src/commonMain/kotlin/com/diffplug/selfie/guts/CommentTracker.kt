/*
 * Copyright (C) 2024-2025 DiffPlug
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
  }
  private val cache = atomic(ArrayMap.empty<TypedPath, WritableComment>())
  fun pathsWithOnce(): Iterable<TypedPath> =
      cache.get().mapNotNull { if (it.value == WritableComment.ONCE) it.key else null }
  fun hasWritableComment(call: CallStack, layout: SnapshotFileLayout): Boolean {
    val path = layout.sourcePathForCall(call.location)
    val comment = cache.get()[path]
    return if (comment != null) {
      comment.writable
    } else {
      val newComment = commentAndLine(path, layout.fs).first
      // may race get(), ignore if already present
      cache.updateAndGet { it.plusOrNoOp(path, newComment) }
      newComment.writable
    }
  }

  companion object {
    fun commentString(typedPath: TypedPath, fs: FS): Pair<String, Int> {
      val (comment, line) = commentAndLine(typedPath, fs)
      return when (comment) {
        WritableComment.NO_COMMENT -> throw UnsupportedOperationException()
        WritableComment.ONCE -> Pair("//selfieonce", line)
        WritableComment.FOREVER -> Pair("//SELFIEWRITE", line)
      }
    }
    private fun commentAndLine(typedPath: TypedPath, fs: FS): Pair<WritableComment, Int> {
      // TODO: there is a bug here due to string constants, and non-C file comments
      val content = Slice(fs.fileRead(typedPath))
      for (comment in listOf("//selfieonce", "// selfieonce", "//SELFIEWRITE", "// SELFIEWRITE")) {
        val index = content.indexOf(comment)
        if (index != -1) {
          val lineNumber = content.baseLineAtOffset(index)
          val comment =
              if (comment.contains("once")) WritableComment.ONCE else WritableComment.FOREVER
          return Pair(comment, lineNumber)
        }
      }
      return Pair(WritableComment.NO_COMMENT, -1)
    }
  }
}
