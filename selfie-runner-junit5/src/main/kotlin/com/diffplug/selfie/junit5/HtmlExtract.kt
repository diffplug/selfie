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
package com.diffplug.selfie.junit5

import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SnapshotValue
import kotlin.math.absoluteValue
import org.jsoup.Jsoup

internal class HtmlExtract(val cssSelector: String, val expectedCountNegativeIfForgiving: Int) :
    SnapshotLens {
  override val defaultLensName = "htmlExtract[$cssSelector]"
  override fun transform(
      className: String,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): SnapshotValue? {
    if (!snapshot.value.isString) {
      return null
    }
    val doc = Jsoup.parse(snapshot.value.valueString())
    doc.outputSettings().prettyPrint(true)
    val elements = doc.select(cssSelector)
    if (expectedCountNegativeIfForgiving == 0 ||
        elements.size == expectedCountNegativeIfForgiving.absoluteValue) {
      val str = elements.joinToString(separator = "\n\n") { it.outerHtml() }
      return SnapshotValue.of(str)
    }
    if (expectedCountNegativeIfForgiving < 0) {
      return null
    } else {
      throw AssertionError(
          "Expected $expectedCountNegativeIfForgiving elements, but found ${elements.size} for selector '$cssSelector'")
    }
  }
}
