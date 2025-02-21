/*
 * Copyright (C) 2023-2025 DiffPlug
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
            ╔═ [end of file] ═╗
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
            ╔═ [end of file] ═╗
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
            "Apple",
            Snapshot.of("Granny Smith").plusFacet("color", "green").plusFacet("crisp", "yes"))
    underTest.snapshots = underTest.snapshots.plus("Orange", Snapshot.of("Orange"))
    val buffer = StringBuilder()
    underTest.serialize(buffer)
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
            ╔═ [end of file] ═╗
            
      """
            .trimIndent()
  }

  @Test
  fun escapingBug() {
    val file =
        SnapshotFile.parse(
            SnapshotValueReader.of(
                """
╔═ trialStarted/stripe ═╗

╔═ trialStarted/stripe[«1»{\n    "params": {\n        "line_items": "line_items=\({quantity=1, price=price_xxxx}\)"\n    },\n    "apiMode": "V1"\n}] ═╗
{}
╔═ [end of file] ═╗

"""
                    .trimIndent()))
    val keys = file.snapshots.keys.toList()
    keys.size shouldBe 1
    keys[0] shouldBe "trialStarted/stripe"
    val snapshot = file.snapshots.get(keys[0])!!

    snapshot.facets.keys.size shouldBe 1
    snapshot.facets.keys.first() shouldBe
        """«1»{
    "params": {
        "line_items": "line_items=[{quantity=1, price=price_xxxx}]"
    },
    "apiMode": "V1"
}"""
  }
}
