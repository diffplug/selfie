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
import com.diffplug.selfie.Snapshotter
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

interface SelfieSettingsAPI {
  fun openPipeline(layout: SnapshotFileLayout): SnapshotPipe = SnapshotPipeNoOp
  fun expectImplictSnapshotter(underTest: Any): Snapshotter<*> =
      throw AssertionError("Implicit snapshots have not been setup, see TODO.")

  /**
   * Defaults to `__snapshot__`, null means that snapshots are stored at the same folder location as
   * the test that created them.
   */
  val snapshotFolderName: String?
    get() = "__snapshots__"

  /** By default, the root folder is the first of the standard test directories. */
  val rootFolder: Path
    get() {
      val userDir = Paths.get(System.getProperty("user.dir"))
      for (standardDir in STANDARD_DIRS) {
        val candidate = userDir.resolve(standardDir)
        if (Files.isDirectory(candidate)) {
          return candidate
        }
      }
      throw AssertionError(
          "Could not find a standard test directory, 'user.dir' is equal to $userDir, looked in $STANDARD_DIRS")
    }

  companion object {
    private val STANDARD_DIRS =
        listOf(
            "src/test/java",
            "src/test/kotlin",
            "src/test/groovy",
            "src/test/scala",
            "src/test/resources")
    internal fun initialize(): SelfieSettingsAPI {
      try {
        val clazz = Class.forName("com.diffplug.selfie.SelfieSettings")
        return clazz.getDeclaredConstructor().newInstance() as SelfieSettingsAPI
      } catch (e: ClassNotFoundException) {
        return StandardSelfieSettings()
      } catch (e: InstantiationException) {
        throw AssertionError("Unable to instantiate dev.selfie.SelfieSettings, is it abstract?", e)
      }
    }
  }
}

/** Transforms a full snapshot into a new snapshot. */
interface SnapshotPipe : AutoCloseable {
  fun transform(className: String, key: String, callStack: CallStack, snapshot: Snapshot): Snapshot
}

object SnapshotPipeNoOp : SnapshotPipe {
  override fun transform(testClass: String, key: String, callStack: CallStack, snapshot: Snapshot) =
      snapshot
  override fun close() {}
}

/** Extracts a specific value out of an existing snapshot. */
interface SnapshotLens : AutoCloseable {
  val defaultLensName: String
  fun transform(
      testClass: String,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): SnapshotValue?
  override fun close() {
    // optional
  }

  companion object {
    fun htmlToMd() = com.diffplug.selfie.junit5.HtmlToMd()
    fun htmlPrettyPrint() = com.diffplug.selfie.junit5.HtmlPrettyPrint()
    fun htmlExtractCssN(cssSelector: String): SnapshotLens =
        com.diffplug.selfie.junit5.HtmlExtract(cssSelector, 0)
    fun htmlExtractCssExactlyOne(cssSelector: String): SnapshotLens =
        com.diffplug.selfie.junit5.HtmlExtract(cssSelector, 1)
    fun htmlExtractCssExactlyOneOrNull(cssSelector: String): SnapshotLens =
        com.diffplug.selfie.junit5.HtmlExtract(cssSelector, -1)
  }
  fun andThen(lens: SnapshotLens): SnapshotLens = SnapshotLensSequence(this, lens)
}

internal class SnapshotLensSequence(val first: SnapshotLens, val second: SnapshotLens) :
    SnapshotLens {
  override val defaultLensName: String
    get() = "${first.defaultLensName}⇒${second.defaultLensName}"
  override fun transform(
      testClass: String,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): SnapshotValue? =
      first.transform(testClass, key, callStack, snapshot)?.let {
        second.transform(testClass, key, callStack, snapshot.withNewRoot(it))
      }
}
fun interface SnapshotPredicate {
  fun test(testClass: String, key: String, callStack: CallStack, snapshot: Snapshot): Boolean
}

open class PipeWhere : SnapshotPipe {
  private val predicates = mutableListOf<SnapshotPredicate>()
  private val toApply = mutableListOf<SnapshotPipe>()
  fun matches(predicate: (String, String, CallStack, Snapshot) -> Boolean): PipeWhere {
    predicates.add(predicate)
    return this
  }
  fun contentIsString(predicate: (String) -> Boolean) = matches { _, _, _, snapshot ->
    snapshot.value.isString && predicate(snapshot.value.valueString())
  }
  fun contentIsHtml(): PipeWhere {
    val regex = "<\\/?[a-z][\\s\\S]*>".toRegex()
    return contentIsString { regex.find(it) != null }
  }
  private fun addLensOrReplaceRoot(name: String?, lens: SnapshotLens) {
    toApply.add(
        object : SnapshotPipe {
          override fun transform(
              testClass: String,
              key: String,
              callStack: CallStack,
              snapshot: Snapshot
          ): Snapshot {
            var lensValue: SnapshotValue?
            try {
              lensValue = lens.transform(testClass, key, callStack, snapshot)
            } catch (e: Throwable) {
              lensValue = SnapshotValue.of(e.stackTraceToString())
            }
            return if (lensValue == null) snapshot
            else {
              if (name == null) snapshot.withNewRoot(lensValue) else snapshot.lens(name, lensValue)
            }
          }
          override fun close() = lens.close()
        })
  }
  fun addLens(name: String, lens: SnapshotLens) = addLensOrReplaceRoot(name, lens)
  fun addLens(lens: SnapshotLens) = addLensOrReplaceRoot(lens.defaultLensName, lens)
  fun replaceRootWith(lens: SnapshotLens) = addLensOrReplaceRoot(null, lens)
  override fun transform(
      testClass: String,
      key: String,
      callStack: CallStack,
      snapshot: Snapshot
  ): Snapshot {
    var current = snapshot
    toApply.forEach { current = it.transform(testClass, key, callStack, snapshot) }
    return current
  }
  override fun close() {
    toApply.forEach { it.close() }
  }
}

open class StandardSelfieSettings : SelfieSettingsAPI {
  private val pipes = mutableListOf<PipeWhere>()
  protected fun addPipeWhere(): PipeWhere {
    val newPipe = PipeWhere()
    pipes.add(newPipe)
    return newPipe
  }
  override fun openPipeline(layout: SnapshotFileLayout): SnapshotPipe {
    return object : SnapshotPipe {
      override fun transform(
          testClass: String,
          key: String,
          callStack: CallStack,
          snapshot: Snapshot
      ): Snapshot {
        var current = snapshot
        pipes.forEach { current = it.transform(testClass, key, callStack, current) }
        return current
      }
      override fun close() {
        pipes.forEach { it.close() }
      }
    }
  }
}

class Example : StandardSelfieSettings() {
  init {
    addPipeWhere().contentIsHtml().replaceRootWith(SnapshotLens.htmlPrettyPrint())
    addPipeWhere()
        .contentIsHtml()
        .addLens(
            SnapshotLens.htmlExtractCssExactlyOneOrNull("content").andThen(SnapshotLens.htmlToMd()))
  }
}
