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
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.TypedPath

enum class Mode {
  interactive,
  readonly,
  overwrite;
  internal fun canWrite(isTodo: Boolean, call: CallStack, system: SnapshotSystem): Boolean =
      when (this) {
        interactive -> isTodo || system.sourceFileHasWritableComment(call)
        readonly -> {
          if (system.sourceFileHasWritableComment(call)) {
            val layout = system.layout
            val path = layout.sourcePathForCall(call.location)
            val (comment, line) = CommentTracker.commentString(path, system.fs)
            throw system.fs.assertFailed(
                "Selfie is in readonly mode, so `$comment` is illegal at ${call.location.withLine(line).ideLink(layout)}")
          }
          false
        }
        overwrite -> true
      }
  internal fun msgSnapshotNotFound() = msg("Snapshot not found")
  internal fun msgSnapshotNotFoundNoSuchFile(file: TypedPath) =
      msg("Snapshot not found: no such file $file")
  internal fun msgSnapshotMismatch(expected: String, actual: String) = msg("Snapshot mismatch")
  internal fun msgSnapshotMismatchBinary(expected: ByteArray, actual: ByteArray) =
      msg("Snapshot mismatch")
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
