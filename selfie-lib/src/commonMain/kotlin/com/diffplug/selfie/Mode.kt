/*
 * Copyright (C) 2023-2024 DiffPlug
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
import com.diffplug.selfie.guts.CommentTracker
import com.diffplug.selfie.guts.SnapshotStorage

enum class Mode {
  interactive,
  readonly,
  overwrite;
  fun canWrite(isTodo: Boolean, call: CallStack, storage: SnapshotStorage): Boolean =
      when (this) {
        interactive -> isTodo || storage.sourceFileHasWritableComment(call)
        readonly -> {
          if (storage.sourceFileHasWritableComment(call)) {
            val layout = storage.layout
            val path = layout.sourcePathForCall(call.location)
            val (comment, line) = CommentTracker.commentString(path, storage.fs)
            throw storage.fs.assertFailed(
                "Selfie is in readonly mode, so `$comment` is illegal at ${call.location.withLine(line).ideLink(layout)}")
          }
          false
        }
        overwrite -> true
      }
  fun msgSnapshotNotFound() = msg("Snapshot not found")
  fun msgSnapshotMismatch() = msg("Snapshot mismatch")
  private fun msg(headline: String) =
      when (this) {
        interactive ->
            "$headline\n" +
                "- update this snapshot by adding `_TODO` to the function name\n" +
                "- update all snapshots in this file by adding `//selfieonce` or `//SELFIEWRITE`"
        readonly -> headline
        overwrite -> "$headline\n(didn't expect this to ever happen in overwrite mode)"
      }
}
