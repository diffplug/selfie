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
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import org.jsoup.Jsoup

class HtmlSnapshotAssets(val prefix: String) : SnapshotPipe {
  override fun transform(
      className: String,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): Snapshot {
    val doc = Jsoup.parse(snapshot.value.valueString())
    val cssLinks = doc.select("link[href]")
    for (link in cssLinks) {
      if (link.attr("rel").lowercase() == "stylesheet") {
        val cssLink = link.attr("href")
        if (cssLink.startsWith(prefix)) {
          link.attr("href", store(cssLink))
        }
        System.out.println("CSS link: " + link.attr("href"))
      }
    }

    // Extracting all JS scripts
    val jsScripts = doc.select("script[src]")
    for (script in jsScripts) {
      val jsLink = script.attr("src")
      if (jsLink.startsWith(prefix)) {
        script.attr("src", store(jsLink))
      }
      System.out.println("JS script: " + script.attr("src"))
    }
    return Snapshot.of("TODO")
  }
  private fun store(asset: String): String {
    return asset.substring(prefix.length)
  }
  override fun close() {
    TODO("Not yet implemented")
  }

  class Storage {
    val utf8 = Charset.forName("UTF-8")
    fun process(urlString: String): SnapshotValue {
      val url = URL(urlString)
      url.openStream().use {
        val content = it.readBytes()
        val decoder = utf8.newDecoder()
        decoder.onMalformedInput(CodingErrorAction.REPORT)
        decoder.onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
          // treat UTF-8 as string
          val buffer = ByteBuffer.wrap(content)
          SnapshotValue.of(decoder.decode(buffer).toString())
        } catch (e: CharacterCodingException) {
          // treat non-UTF-8 as binary
          SnapshotValue.of(content)
        }
      }
    }
  }
}
