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

class SnapshotFileTest {
  @Test
  fun readWithMetadata() {
    val file =
        SnapshotFile.parse(
            SnapshotValueReader.of(
                """
            ╔═ 📷 com.acme.AcmeTest ═╗
            {"header":"data"}
            ╔═ Apple ═╗
            Granny Smith
            ╔═ Apple[color] ═╗
            green
            ╔═ Apple[crisp] ═╗
            yes
            ╔═ Orange ═╗
            Orange
        """
                    .trimIndent()))
    file.metadata shouldBe entry("com.acme.AcmeTest", """{"header":"data"}""")
    file.snapshots.keys shouldBe setOf("Apple", "Orange")
  }

  @Test
  fun readWithoutMetadata() {
    val file =
        SnapshotFile.parse(
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
    file.metadata shouldBe null
    file.snapshots.keys shouldBe setOf("Apple", "Orange")
  }

  @Test
  fun write() {
    val underTest = SnapshotFile()
    underTest.metadata = entry("com.acme.AcmeTest", """{"header":"data"}""")
    underTest.snapshots =
        underTest.snapshots.plus(
            "Apple", Snapshot.of("Granny Smith").lens("color", "green").lens("crisp", "yes"))
    underTest.snapshots = underTest.snapshots.plus("Orange", Snapshot.of("Orange"))
    val buffer = StringBuffer()
    underTest.serialize { line -> buffer.append(line) }
    buffer.toString() shouldBe
        """
            ╔═ 📷 com.acme.AcmeTest ═╗
            {"header":"data"}
            ╔═ Apple ═╗
            Granny Smith
            ╔═ Apple[color] ═╗
            green
            ╔═ Apple[crisp] ═╗
            yes
            ╔═ Orange ═╗
            Orange
      """
            .trimIndent()
  }
}
