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

import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.TypedPath
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SnapshotFacetBugTest {
  /**
   * This test reproduces the bug where adding a new facet to a snapshot that was already stored on
   * disk causes a StringIndexOutOfBoundsException during comparison.
   */
  @Test
  fun testAddingNewFacetToStoredSnapshot() {
    // Create a simple mock FS
    val mockFs =
        object : FS {
          override fun fileExists(typedPath: TypedPath): Boolean = false
          override fun <T> fileWalk(typedPath: TypedPath, walk: (Sequence<TypedPath>) -> T): T =
              throw UnsupportedOperationException("Not needed for this test")
          override fun fileReadBinary(typedPath: TypedPath): ByteArray =
              throw UnsupportedOperationException("Not needed for this test")
          override fun fileWriteBinary(typedPath: TypedPath, content: ByteArray) {
            // Not needed for this test
          }
          override fun assertFailed(message: String, expected: Any?, actual: Any?): Throwable =
              AssertionError(message)
        }

    // Create a simple mock SnapshotSystem
    val mockSystem =
        object : SnapshotSystem {
          override val fs = mockFs
          override val mode = Mode.readonly
          override val layout =
              object : com.diffplug.selfie.guts.SnapshotFileLayout {
                override val rootFolder = TypedPath.ofFolder("/test/")
                override val fs = mockFs
                override val allowMultipleEquivalentWritesToOneLocation = false
                override val javaDontUseTripleQuoteLiterals = false
                override fun sourcePathForCall(
                    call: com.diffplug.selfie.guts.CallLocation
                ): TypedPath = TypedPath.ofFile("/test/Test.kt")
                override fun sourcePathForCallMaybe(
                    call: com.diffplug.selfie.guts.CallLocation
                ): TypedPath? = TypedPath.ofFile("/test/Test.kt")
                override fun checkForSmuggledError() {
                  // Not needed for this test
                }
              }
          override fun sourceFileHasWritableComment(
              call: com.diffplug.selfie.guts.CallStack
          ): Boolean = false
          override fun writeInline(
              literalValue: com.diffplug.selfie.guts.LiteralValue<*>,
              call: com.diffplug.selfie.guts.CallStack
          ) {
            // Not needed for this test
          }
          override fun writeToBeFile(
              path: TypedPath,
              data: ByteArray,
              call: com.diffplug.selfie.guts.CallStack
          ) {
            // Not needed for this test
          }
          override fun diskThreadLocal() =
              throw UnsupportedOperationException("Not needed for this test")
        }

    // Step 1: Create a simple snapshot (this would be the one stored on disk)
    val storedSnapshot = Snapshot.of("")

    // Step 2: Create a new snapshot with an added facet
    val updatedSnapshot = Snapshot.of("").plusFacet("new-facet", "new-facet-value")

    // Step 3: This should throw a StringIndexOutOfBoundsException due to the bug
    val exception =
        shouldThrow<StringIndexOutOfBoundsException> {
          assertEqual(storedSnapshot, updatedSnapshot, mockSystem)
        }

    // Verify the exception message matches the expected error
    exception.message shouldBe "String index out of range: -1"
  }
}
