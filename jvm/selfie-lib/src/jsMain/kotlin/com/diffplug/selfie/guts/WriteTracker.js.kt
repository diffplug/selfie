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

actual data class CallLocation(actual val fileName: String?, actual val line: Int) :
    Comparable<CallLocation> {
  actual override fun compareTo(other: CallLocation) =
      compareValuesBy(this, other, { it.fileName }, { it.line })
  actual fun withLine(line: Int): CallLocation = TODO()
  actual fun ideLink(layout: SnapshotFileLayout): String = TODO()
  actual fun samePathAs(other: CallLocation): Boolean = TODO()
  actual fun sourceFilenameWithoutExtension(): String = TODO()
}

internal actual fun recordCall(callerFileOnly: Boolean): CallStack = TODO()
