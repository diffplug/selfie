/*
 * Copyright (C) 2023 DiffPlug
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

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SnapshotReaderTest {
  @Test
  fun lens() {
    val reader =
        SnapshotReader(
            SnapshotValueReader.of(
                """
            ╔═ Apple ═╗
            Apple
            ╔═ Apple[color] ═╗
            green
            ╔═ Apple[crisp] ═╗
            yes
            ╔═ Orange ═╗
            Orange
        """
                    .trimIndent()))
    reader.peekKey() shouldBe "Apple"
    reader.peekKey() shouldBe "Apple"
    reader.nextSnapshot() shouldBe Snapshot.of("Apple").lens("color", "green").lens("crisp", "yes")
    reader.peekKey() shouldBe "Orange"
    reader.peekKey() shouldBe "Orange"
    reader.nextSnapshot() shouldBe Snapshot.of("Orange")
    reader.peekKey() shouldBe null
  }
}
