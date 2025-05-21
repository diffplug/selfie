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
package com.diffplug.selfie.junit5

import com.diffplug.selfie.*
import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.CommentTracker
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.DiskWriteTracker
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.InlineWriteTracker
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.ToBeFileWriteTracker
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.WithinTestGC
import com.diffplug.selfie.guts.atomic
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.io.path.absolutePathString
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.streams.asSequence
import org.opentest4j.AssertionFailedError
internal fun TypedPath.toPath(): java.nio.file.Path = java.nio.file.Path.of(absolutePath)

internal object FSJava : FS {
  override fun fileExists(typedPath: TypedPath): Boolean = Files.isRegularFile(typedPath.toPath())
  override fun fileWriteBinary(typedPath: TypedPath, content: ByteArray) =
      typedPath.toPath().writeBytes(content)
  override fun fileReadBinary(typedPath: TypedPath) = typedPath.toPath().readBytes()
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  override fun <T> fileWalk(typedPath: TypedPath, walk: (Sequence<TypedPath>) -> T): T =
      Files.walk(typedPath.toPath()).use { paths ->
        walk(
            paths.asSequence().mapNotNull {
              if (Files.isRegularFile(it)) TypedPath.ofFile(it.absolutePathString()) else null
            })
      }
  override fun assertFailed(message: String, expected: Any?, actual: Any?): Error =
      if (expected == null && actual == null) AssertionFailedError(message)
      else AssertionFailedError(message, expected, actual)
}

/** Routes between `toMatchDisk()` calls and the snapshot file / pruning machinery. */
internal object SnapshotSystemJUnit5 : SnapshotSystem {
  @JvmStatic fun initStorage(): SnapshotSystem = this
  override val fs = FSJava
  override val mode = calcMode()
  override val layout = SnapshotFileLayoutJUnit5(SelfieSettingsAPI.initialize(), fs)
  private val commentTracker = CommentTracker()
  private val inlineWriteTracker = InlineWriteTracker()
  private val toBeFileWriteTracker = ToBeFileWriteTracker()
  private val progressPerClass = atomic(ArrayMap.empty<String, SnapshotFileProgress>())
  fun forClass(className: String): SnapshotFileProgress {
    // optimize for reads
    progressPerClass.get()[className]?.let {
      return it
    }
    // sometimes we'll have to write
    return progressPerClass
        .updateAndGet { it.plusOrNoOp(className, SnapshotFileProgress(this, className)) }[
            className]!!
  }
  private val checkForInvalidStale = atomic<ArraySet<TypedPath>?>(ArraySet.empty())
  internal fun markPathAsWritten(typedPath: TypedPath) {
    checkForInvalidStale.updateAndGet {
      if (it == null)
          throw AssertionError("Snapshot file is being written after all tests were finished.")
      it.plusOrThis(typedPath)
    }
  }
  override fun sourceFileHasWritableComment(call: CallStack): Boolean {
    return commentTracker.hasWritableComment(call, layout)
  }
  override fun writeInline(literalValue: LiteralValue<*>, call: CallStack) {
    inlineWriteTracker.record(call, literalValue, layout)
  }
  override fun writeToBeFile(path: TypedPath, data: ByteArray, call: CallStack) {
    toBeFileWriteTracker.writeToDisk(path, data, call, layout)
  }
  internal val testListenerRunning = AtomicBoolean(false)
  fun finishedAllTests() {
    val snapshotsFilesWrittenToDisk =
        checkForInvalidStale.getAndUpdate { null }
            ?: throw AssertionError("finishedAllTests() was called more than once.")

    if (mode != Mode.readonly) {
      for (path in commentTracker.pathsWithOnce()) {
        val source = layout.parseSourceFile(path)
        source.removeSelfieOnceComments()
        layout.fs.fileWrite(path, source.asString)
      }
      if (inlineWriteTracker.hasWrites()) {
        inlineWriteTracker.persistWrites(layout)
      }
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
  private val threadCtx = ThreadLocal<DiskStorageJUnit5>()
  override fun diskThreadLocal(): DiskStorage =
      threadCtx.get()
          ?: throw fs.assertFailed(
              """
        No JUnit test is in progress on this thread. If this is a Kotest test, make the following change:
          -import com.diffplug.selfie.Selfie.expectSelfie
          +import com.diffplug.selfie.coroutines.expectSelfie
        For more info https://selfie.dev/jvm/kotest#selfie-and-coroutines
      """
                  .trimIndent())
  internal fun startThreadLocal(clazz: SnapshotFileProgress, test: String) {
    val ft = threadCtx.get()
    check(ft == null) {
      "THREAD ERROR: ${ft!!.file.className}#${ft.test} is in progress, cannot start ${clazz.className}#$test"
    }
    threadCtx.set(DiskStorageJUnit5(clazz, test))
  }
  internal fun finishThreadLocal(clazz: SnapshotFileProgress, test: String) {
    val ft = threadCtx.get()
    check(ft != null) { "THREAD ERROR: no test is in progress, cannot finish $clazz#$test" }
    check(ft.file == clazz && ft.test == test) {
      "THREAD ERROR: ${ft.file.className}#${ft.test} is in progress, cannot finish ${clazz.className}#$test"
    }
    threadCtx.set(null)
  }
}

internal data class DiskStorageJUnit5(val file: SnapshotFileProgress, val test: String) :
    DiskStorage, Comparable<DiskStorageJUnit5> {
  override fun readDisk(sub: String, call: CallStack): Snapshot? = file.read(test, suffix(sub))
  override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) {
    file.write(test, suffix(sub), actual, call, file.system.layout)
  }
  override fun keep(subOrKeepAll: String?) {
    file.keep(test, subOrKeepAll?.let { suffix(it) })
  }
  private fun suffix(sub: String) = if (sub == "") "" else "/$sub"
  override fun compareTo(other: DiskStorageJUnit5): Int =
      compareValuesBy(this, other, { it.file.className }, { it.test })
  override fun toString(): String = "${file.className}#$test"
}

/**
 * Tracks the progress of test runs within a single disk snapshot file, so that snapshots can be
 * pruned.
 */
internal class SnapshotFileProgress(val system: SnapshotSystemJUnit5, val className: String) {
  companion object {
    val TERMINATED =
        ArrayMap.empty<String, WithinTestGC>().plus(" ~ / f!n1shed / ~ ", WithinTestGC())
  }
  private fun assertNotTerminated() {
    require(tests.get() !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file = atomic<SnapshotFile?>(null)
  private val tests = atomic(ArrayMap.empty<String, WithinTestGC>())
  private var diskWriteTracker = atomic<DiskWriteTracker?>(DiskWriteTracker())
  private val timesStarted = AtomicInteger(0)
  private val hasFailed = AtomicBoolean(false)

  /** Assigns this thread to store disk snapshots within this file with the name `test`. */
  fun startTest(test: String, usesThreadLocal: Boolean) {
    check(test.indexOf('/') == -1) { "Test name cannot contain '/', was $test" }
    assertNotTerminated()
    tests.updateAndGet { it.plusOrNoOp(test, WithinTestGC()) }
    if (usesThreadLocal) {
      system.startThreadLocal(this, test)
    }
  }
  /**
   * Stops assigning this thread to store snapshots within this file at `test`, and if successful
   * marks that all other snapshots of this test can be pruned. A single test can be run multiple
   * times (as in `@ParameterizedTest`), and GC will only happen if all runs of the test are
   * successful.
   */
  fun finishedTestWithSuccess(test: String, usesThreadLocal: Boolean, success: Boolean) {
    assertNotTerminated()
    if (!success) {
      tests.get()[test]!!.keepAll()
    }
    if (usesThreadLocal) {
      system.finishThreadLocal(this, test)
    }
  }
  private fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    diskWriteTracker.updateAndGet { null } // don't need this anymore
    val tests = tests.getAndUpdate { TERMINATED }
    require(tests !== TERMINATED) { "Snapshot $className already terminated!" }
    val file = file.getAndUpdate { null }
    if (file != null) {
      val staleSnapshotIndices =
          WithinTestGC.findStaleSnapshotsWithin(
              file.snapshots, tests, findTestMethodsThatDidntRun(className, tests))
      if (staleSnapshotIndices.isNotEmpty() || file.wasSetAtTestTime) {
        file.removeAllIndices(staleSnapshotIndices)
        val snapshotPath = system.layout.snapshotPathForClass(className)
        if (file.snapshots.isEmpty()) {
          deleteFileAndParentDirIfEmpty(snapshotPath)
        } else {
          system.markPathAsWritten(system.layout.snapshotPathForClass(className))
          Files.createDirectories(snapshotPath.toPath().parent)
          Files.newBufferedWriter(snapshotPath.toPath(), StandardCharsets.UTF_8).use { writer ->
            file.serialize(writer)
          }
        }
      }
    } else {
      // we never read or wrote to the file
      val everyTestInClassRan = findTestMethodsThatDidntRun(className, tests).none()
      val isStale =
          everyTestInClassRan && success && tests.values.all { it.succeededAndUsedNoSnapshots() }
      if (isStale) {
        val snapshotFile = system.layout.snapshotPathForClass(className)
        deleteFileAndParentDirIfEmpty(snapshotFile)
      }
    }
  }
  // the methods below are called from the test thread for I/O on snapshots
  fun keep(test: String, suffixOrAll: String?) {
    assertNotTerminated()
    if (suffixOrAll == null) {
      tests.get()[test]!!.keepAll()
    } else {
      tests.get()[test]!!.keepSuffix(suffixOrAll)
    }
  }
  fun write(
      test: String,
      suffix: String,
      snapshot: Snapshot,
      callStack: CallStack,
      layout: SnapshotFileLayout
  ) {
    assertNotTerminated()
    val key = "$test$suffix"
    diskWriteTracker.get()!!.record(key, snapshot, callStack, layout)
    tests.get()[test]!!.keepSuffix(suffix)
    read().setAtTestTime(key, snapshot)
  }
  fun read(test: String, suffix: String): Snapshot? {
    assertNotTerminated()
    val snapshot = read().snapshots["$test$suffix"]
    if (snapshot != null) {
      tests.get()[test]!!.keepSuffix(suffix)
    }
    return snapshot
  }
  private fun read(): SnapshotFile {
    val file = this.file.get()
    if (file != null) return file

    return this.file.updateAndGet { file ->
      if (file != null) {
        file
      } else {
        val snapshotPath = system.layout.snapshotPathForClass(className).toPath()
        if (Files.exists(snapshotPath) && Files.isRegularFile(snapshotPath)) {
          val content = Files.readAllBytes(snapshotPath)
          SnapshotFile.parse(SnapshotValueReader.of(content))
        } else {
          SnapshotFile.createEmptyWithUnixNewlines(system.layout.unixNewlines)
        }
      }
    }!!
  }
  fun incrementContainers() {
    assertNotTerminated()
    timesStarted.incrementAndGet()
  }
  fun decrementContainersWithSuccess(success: Boolean) {
    assertNotTerminated()
    if (!success) {
      hasFailed.set(true)
    }
    if (timesStarted.decrementAndGet() == 0) {
      finishedClassWithSuccess(hasFailed.get())
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
