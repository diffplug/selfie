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

import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.TypedPath
import io.kotest.assertions.Actual
import io.kotest.assertions.AssertionErrorBuilder
import io.kotest.assertions.Expected
import io.kotest.assertions.print.Printed
import okio.FileSystem
import okio.Path.Companion.toPath

internal expect val FS_SYSTEM: FileSystem
internal fun TypedPath.toPath(): okio.Path = absolutePath.toPath()

internal object FSOkio : FS {
  override fun fileExists(typedPath: TypedPath): Boolean =
      FS_SYSTEM.metadataOrNull(typedPath.toPath())?.isRegularFile ?: false
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  override fun <T> fileWalk(typedPath: TypedPath, walk: (Sequence<TypedPath>) -> T): T =
      walk(
          FS_SYSTEM.listRecursively(typedPath.toPath()).mapNotNull {
            if (FS_SYSTEM.metadata(it).isRegularFile) TypedPath.ofFile(it.toString()) else null
          })
  override fun fileReadBinary(typedPath: TypedPath): ByteArray =
      FS_SYSTEM.read(typedPath.toPath()) { readByteArray() }
  override fun fileWriteBinary(typedPath: TypedPath, content: ByteArray): Unit =
      FS_SYSTEM.write(typedPath.toPath()) { write(content) }
  /** Creates an assertion failed exception to throw. */
  override fun assertFailed(message: String, expected: Any?, actual: Any?): Throwable =
      if (expected == null && actual == null) AssertionErrorBuilder.create().withMessage(message).build()
      else {
        val expectedStr = nullableToString(expected, "")
        val actualStr = nullableToString(actual, "")
        if (expectedStr.isEmpty() && actualStr.isEmpty() && (expected == null || actual == null)) {
          // make sure that nulls are not ambiguous
          val onNull = "(null)"
          comparisonAssertion(
              message, nullableToString(expected, onNull), nullableToString(actual, onNull))
        } else {
          comparisonAssertion(message, expectedStr, actualStr)
        }
      }
  private fun nullableToString(any: Any?, onNull: String): String =
      any?.toString() ?: onNull
  private fun comparisonAssertion(message: String, expected: String, actual: String): Throwable {
    return AssertionErrorBuilder.create()
      .withMessage(message)
      .withValues(Expected(Printed((expected))), Actual(Printed((actual))))
      .build()
  }
}
