/*
 * Copyright (C) 2023-2024 DiffPlug
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

import com.diffplug.selfie.*
import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.CommentTracker
import com.diffplug.selfie.guts.DiskWriteTracker
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.InlineWriteTracker
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.SnapshotStorage
import com.diffplug.selfie.guts.SourceFile
import com.diffplug.selfie.guts.TypedPath
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.ConcurrentSkipListSet
import java.util.concurrent.atomic.AtomicReference
import kotlin.io.path.absolutePathString
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.streams.asSequence
import org.opentest4j.AssertionFailedError
fun TypedPath.toPath(): java.nio.file.Path = java.nio.file.Path.of(absolutePath)

internal object FSJava : FS {
  override fun fileWrite(file: TypedPath, content: String) = file.toPath().writeText(content)
  override fun fileRead(file: TypedPath) = file.toPath().readText()
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  override fun <T> fileWalk(file: TypedPath, walk: (Sequence<TypedPath>) -> T): T =
      Files.walk(file.toPath()).use {
        walk(
            it.asSequence().mapNotNull {
              if (Files.isRegularFile(it)) TypedPath.ofFile(it.absolutePathString()) else null
            })
      }
  override fun assertFailed(message: String, expected: Any?, actual: Any?): Error =
      if (expected == null && actual == null) AssertionFailedError(message)
      else AssertionFailedError(message, expected, actual)
}
private fun lowercaseFromEnvOrSys(key: String): String? {
  val env = System.getenv(key)?.lowercase()
  if (!env.isNullOrEmpty()) {
    return env
  }
  val system = System.getProperty(key)?.lowercase()
  if (!system.isNullOrEmpty()) {
    return system
  }
  return null
}
private fun calcMode(): Mode {
  val override = lowercaseFromEnvOrSys("selfie") ?: lowercaseFromEnvOrSys("SELFIE")
  if (override != null) {
    return Mode.valueOf(override)
  }
  val ci = lowercaseFromEnvOrSys("ci") ?: lowercaseFromEnvOrSys("CI")
  return if (ci == "true") Mode.readonly else Mode.interactive
}

/** Routes between `toMatchDisk()` calls and the snapshot file / pruning machinery. */
internal object SnapshotStorageJUnit5 : SnapshotStorage {
  @JvmStatic fun initStorage(): SnapshotStorage = this
  override val fs = FSJava
  override val mode = calcMode()
  override val layout: SnapshotFileLayout
    get() = fileAndTest().file.parent.layout

  private class FileAndTest(val file: SnapshotFileProgress, val test: String)
  private val threadCtx = ThreadLocal<FileAndTest?>()
  private fun fileAndTest() =
      threadCtx.get()
          ?: throw AssertionError(
              "Selfie `toMatchDisk` must be called only on the original thread.")
  override fun sourceFileHasWritableComment(call: CallStack): Boolean {
    val cm = fileAndTest()
    return cm.file.parent.commentTracker!!.hasWritableComment(call, cm.file.parent.layout)
  }
  private fun suffix(sub: String) = if (sub == "") "" else "/$sub"
  override fun readDisk(sub: String, call: CallStack): Snapshot? {
    val ft = fileAndTest()
    val suffix = suffix(sub)
    return ft.file.read(ft.test, suffix)
  }
  override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) {
    val ft = fileAndTest()
    val suffix = suffix(sub)
    ft.file.write(ft.test, suffix, actual, call, ft.file.parent.layout)
  }
  override fun keep(subOrKeepAll: String?) {
    val ft = fileAndTest()
    if (subOrKeepAll == null) {
      ft.file.keep(ft.test, null)
    } else {
      ft.file.keep(ft.test, suffix(subOrKeepAll))
    }
  }
  override fun writeInline(literalValue: LiteralValue<*>, call: CallStack) {
    val cm =
        threadCtx.get()
            ?: throw AssertionError("Selfie `toBe` must be called only on the original thread.")
    cm.file.writeInline(call, literalValue, cm.file.parent.layout)
  }
  internal fun start(clazz: SnapshotFileProgress, test: String) {
    val ft = threadCtx.get()
    check(ft == null) {
      "THREAD ERROR: ${ft!!.file.className}#${ft.test} is in progress, cannot start $clazz#$test"
    }
    threadCtx.set(FileAndTest(clazz, test))
  }
  internal fun finish(clazz: SnapshotFileProgress, test: String) {
    val ft = threadCtx.get()
    check(ft != null) { "THREAD ERROR: no test is in progress, cannot finish $clazz#$test" }
    check(ft.file == clazz && ft.test == test) {
      "THREAD ERROR: ${ft.file.className}#${ft.test} is in progress, cannot finish ${clazz.className}#$test"
    }
    threadCtx.set(null)
  }
}

/**
 * Tracks the progress of test runs within a single disk snapshot file, so that snapshots can be
 * pruned.
 */
internal class SnapshotFileProgress(val parent: Progress, val className: String) {
  companion object {
    val TERMINATED = ArrayMap.empty<String, WithinTestGC>().plus(" ~ f!n1shed ~ ", WithinTestGC())
  }
  private fun assertNotTerminated() {
    assert(tests !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file: SnapshotFile? = null
  private var tests = ArrayMap.empty<String, WithinTestGC>()
  private var diskWriteTracker: DiskWriteTracker? = DiskWriteTracker()
  private var inlineWriteTracker: InlineWriteTracker? = InlineWriteTracker()

  /** Assigns this thread to store disk snapshots within this file with the name `test`. */
  @Synchronized fun startTest(test: String) {
    check(test.indexOf('/') == -1) { "Test name cannot contain '/', was $test" }
    assertNotTerminated()
    SnapshotStorageJUnit5.start(this, test)
    tests = tests.plusOrNoOp(test, WithinTestGC())
  }
  /**
   * Stops assigning this thread to store snapshots within this file at `test`, and if successful
   * marks that all other snapshots of this test can be pruned. A single test can be run multiple
   * times (as in `@ParameterizedTest`), and GC will only happen if all runs of the test are
   * successful.
   */
  @Synchronized fun finishedTestWithSuccess(test: String, success: Boolean) {
    assertNotTerminated()
    SnapshotStorageJUnit5.finish(this, test)
    if (!success) {
      tests[test]!!.keepAll()
    }
  }
  @Synchronized fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    if (inlineWriteTracker!!.hasWrites()) {
      inlineWriteTracker!!.persistWrites(parent.layout)
    }
    if (file != null) {
      val staleSnapshotIndices =
          WithinTestGC.findStaleSnapshotsWithin(className, file!!.snapshots, tests)
      if (staleSnapshotIndices.isNotEmpty() || file!!.wasSetAtTestTime) {
        file!!.removeAllIndices(staleSnapshotIndices)
        val snapshotPath = parent.layout.snapshotPathForClass(className)
        if (file!!.snapshots.isEmpty()) {
          deleteFileAndParentDirIfEmpty(snapshotPath)
        } else {
          parent.markPathAsWritten(parent.layout.snapshotPathForClass(className))
          Files.createDirectories(snapshotPath.toPath().parent)
          Files.newBufferedWriter(snapshotPath.toPath(), StandardCharsets.UTF_8).use { writer ->
            file!!.serialize(writer)
          }
        }
      }
    } else {
      // we never read or wrote to the file
      val everyTestInClassRan = findTestMethodsThatDidntRun(className, tests).none()
      val isStale =
          everyTestInClassRan && success && tests.values.all { it.succeededAndUsedNoSnapshots() }
      if (isStale) {
        val snapshotFile = parent.layout.snapshotPathForClass(className)
        deleteFileAndParentDirIfEmpty(snapshotFile)
      }
    }
    // now that we are done, allow our contents to be GC'ed
    tests = TERMINATED
    diskWriteTracker = null
    inlineWriteTracker = null
    file = null
  }
  // the methods below are called from the test thread for I/O on snapshots
  @Synchronized fun keep(test: String, suffixOrAll: String?) {
    assertNotTerminated()
    if (suffixOrAll == null) {
      tests[test]!!.keepAll()
    } else {
      tests[test]!!.keepSuffix(suffixOrAll)
    }
  }
  @Synchronized fun writeInline(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    inlineWriteTracker!!.record(call, literalValue, layout)
  }
  @Synchronized fun write(
      test: String,
      suffix: String,
      snapshot: Snapshot,
      callStack: CallStack,
      layout: SnapshotFileLayout
  ) {
    assertNotTerminated()
    val key = "$test$suffix"
    diskWriteTracker!!.record(key, snapshot, callStack, layout)
    tests[test]!!.keepSuffix(suffix)
    read().setAtTestTime(key, snapshot)
  }
  @Synchronized fun read(test: String, suffix: String): Snapshot? {
    assertNotTerminated()
    val snapshot = read().snapshots["$test$suffix"]
    if (snapshot != null) {
      tests[test]!!.keepSuffix(suffix)
    }
    return snapshot
  }
  private fun read(): SnapshotFile {
    if (file == null) {
      val snapshotPath = parent.layout.snapshotPathForClass(className).toPath()
      file =
          if (Files.exists(snapshotPath) && Files.isRegularFile(snapshotPath)) {
            val content = Files.readAllBytes(snapshotPath)
            SnapshotFile.parse(SnapshotValueReader.of(content))
          } else {
            SnapshotFile.createEmptyWithUnixNewlines(parent.layout.unixNewlines)
          }
    }
    return file!!
  }
}
/**
 * Responsible for
 * - lazily determining the snapshot file layout
 * - pruning unused snapshot files
 */
internal class Progress {
  val settings = SelfieSettingsAPI.initialize()
  val layout = SnapshotFileLayoutJUnit5(settings, SnapshotStorageJUnit5.fs)
  var commentTracker: CommentTracker? = CommentTracker()

  private var progressPerClass = ArrayMap.empty<String, SnapshotFileProgress>()
  fun forClass(className: String): SnapshotFileProgress =
      synchronized(this) {
        val existing = progressPerClass[className]
        return if (existing != null) existing
        else {
          val classProgress = SnapshotFileProgress(this, className)
          progressPerClass = progressPerClass.plus(className, classProgress)
          classProgress
        }
      }

  private var checkForInvalidStale: AtomicReference<MutableSet<TypedPath>?> =
      AtomicReference(ConcurrentSkipListSet())
  internal fun markPathAsWritten(typedPath: TypedPath) {
    val written =
        checkForInvalidStale.get()
            ?: throw AssertionError("Snapshot file is being written after all tests were finished.")
    written.add(typedPath)
  }
  fun finishedAllTests() {
    val pathsWithOnce = commentTracker!!.pathsWithOnce()
    commentTracker = null
    if (SnapshotStorageJUnit5.mode != Mode.readonly) {
      for (path in pathsWithOnce) {
        val source = SourceFile(path.name, layout.fs.fileRead(path))
        source.removeSelfieOnceComments()
        layout.fs.fileWrite(path, source.asString)
      }
    }
    val snapshotsFilesWrittenToDisk =
        checkForInvalidStale.getAndSet(null)
            ?: throw AssertionError("finishedAllTests() was called more than once.")
    for (stale in findStaleSnapshotFiles(layout)) {
      val staleFile = layout.snapshotPathForClass(stale)
      if (snapshotsFilesWrittenToDisk.contains(staleFile)) {
        throw AssertionError(
            "Selfie wrote a snapshot and then marked it stale for deletion in the same run: $staleFile\nSelfie will delete this snapshot on the next run, which is bad! Why is Selfie marking this snapshot as stale?")
      } else {
        deleteFileAndParentDirIfEmpty(staleFile)
      }
    }
  }
}
private fun deleteFileAndParentDirIfEmpty(snapshotFile: TypedPath) {
  if (Files.isRegularFile(snapshotFile.toPath())) {
    Files.delete(snapshotFile.toPath())
    // if the parent folder is now empty, delete it
    val parent = snapshotFile.toPath().parent!!
    if (Files.list(parent).use { !it.findAny().isPresent }) {
      Files.delete(parent)
    }
  }
}
