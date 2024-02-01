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
package com.diffplug.selfie.kotest

import com.diffplug.selfie.guts.TypedPath
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import okio.FileSystem
actual val FS_SYSTEM: FileSystem
  get() = FileSystem.SYSTEM
actual fun exec(cwd: TypedPath, vararg args: String): String {
  val process =
      ProcessBuilder(*args)
          .apply {
            directory(File(cwd.absolutePath))
            redirectErrorStream(true)
          }
          .start()
  val output = StringBuilder()
  BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
    var line: String?
    while (reader.readLine().also { line = it } != null) {
      output.append(line).append("\n")
    }
  }
  process.waitFor()
  return output.toString().replace("\r", "")
}
