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
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.DiskWriteTracker
import com.diffplug.selfie.guts.FS
import com.diffplug.selfie.guts.InlineWriteTracker
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.SourceFile
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.WithinTestGC
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.ConcurrentSkipListSet
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.io.path.absolutePathString
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.streams.asSequence
import org.opentest4j.AssertionFailedError
fun TypedPath.toPath(): java.nio.file.Path = java.nio.file.Path.of(absolutePath)

internal object FSJava : FS {
  override fun fileWrite(typedPath: TypedPath, content: String) =
      typedPath.toPath().writeText(content)
  override fun fileRead(typedPath: TypedPath) = typedPath.toPath().readText()
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
  private val settings = SelfieSettingsAPI.initialize()
  override val layout = SnapshotFileLayoutJUnit5(settings, fs)
  private val commentTracker = CommentTracker()
  private val inlineWriteTracker = InlineWriteTracker()
  private val progressPerClass = AtomicReference(ArrayMap.empty<String, SnapshotFileProgress>())
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

  private var checkForInvalidStale: AtomicReference<MutableSet<TypedPath>?> =
      AtomicReference(ConcurrentSkipListSet())
  internal fun markPathAsWritten(typedPath: TypedPath) {
    val written =
        checkForInvalidStale.get()
            ?: throw AssertionError("Snapshot file is being written after all tests were finished.")
    written.add(typedPath)
  }
  override fun sourceFileHasWritableComment(call: CallStack): Boolean {
    return commentTracker.hasWritableComment(call, layout)
  }
  override fun writeInline(literalValue: LiteralValue<*>, call: CallStack) {
    inlineWriteTracker.record(call, literalValue, layout)
  }
  override suspend fun diskCoroutine(): DiskStorage = TODO()
  override fun diskThreadLocal(): DiskStorage = diskThreadLocalTyped()
  private fun diskThreadLocalTyped(): DiskStorageJUnit5 =
      threadMap.get().get(Thread.currentThread().threadId())
          ?: throw AssertionError("See THREADING GUIDE (TODO)")
  private val threadMap = AtomicReference(ArrayMap.empty<Long, DiskStorageJUnit5>())
  private val missingDowns = AtomicReference(ArrayMap.empty<DiskStorageJUnit5, AtomicInteger>())
  private fun missingDown(disk: DiskStorageJUnit5, delta: Int) {
    missingDowns.updateAndGet { it.plusOrNoOp(disk, AtomicInteger()) }.get(disk)!!.addAndGet(delta)
  }
  internal fun startThreadLocal(file: SnapshotFileProgress, test: String) {
    val threadId = Thread.currentThread().threadId()
    val next = DiskStorageJUnit5(file, test)
    val prevMap = threadMap.getAndUpdate { it.plusOrNoOpOrReplace(threadId, next) }
    val prev = prevMap[threadId]
    if (prev != null) {
      //  now:      .
      // prev: /      \
      // next:    /     \
      missingDown(prev, 1)
    }
  }
  internal fun finishThreadLocal(file: SnapshotFileProgress, test: String) {
    val threadId = Thread.currentThread().threadId()
    val finishing = DiskStorageJUnit5(file, test)
    val prevMap = threadMap.getAndUpdate { it.minusOrNoOp(threadId, finishing) }
    val prev = prevMap[threadId]
    if (prev == finishing) {
      // This is the normal JUnit case, where test notifications come and go on the same thread.
      // Easy! We have removed it from the thread map.
    } else if (prev != finishing) {
      // It probably started on a different thread, yikes
      TODO()
    }
  }
  fun finishedAllTests() {
    val errorMsg =
        missingDowns
            .getAndUpdate { ArrayMap.empty() }
            .mapNotNull {
              val unfinished = it.value.get()
              if (unfinished == 0) null
              else {
                "${it.key} started $unfinished times more than it stopped"
              }
            }
            .joinToString("\n")
    if (errorMsg.isNotEmpty()) {
      throw AssertionError("THREAD ERROR: $errorMsg")
    }
    if (mode != Mode.readonly) {
      for (path in commentTracker.pathsWithOnce()) {
        val source = SourceFile(path.name, layout.fs.fileRead(path))
        source.removeSelfieOnceComments()
        layout.fs.fileWrite(path, source.asString)
      }
      if (inlineWriteTracker.hasWrites()) {
        inlineWriteTracker.persistWrites(layout)
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

  private data class DiskStorageJUnit5(val file: SnapshotFileProgress, val test: String) :
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
}

/**
 * Tracks the progress of test runs within a single disk snapshot file, so that snapshots can be
 * pruned.
 */
internal class SnapshotFileProgress(val system: SnapshotSystemJUnit5, val className: String) {
  companion object {
    val TERMINATED = ArrayMap.empty<String, WithinTestGC>().plus(" ~ f!n1shed ~ ", WithinTestGC())
  }
  private fun assertNotTerminated() {
    require(tests !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file: SnapshotFile? = null
  private val tests = AtomicReference(ArrayMap.empty<String, WithinTestGC>())
  private var diskWriteTracker: DiskWriteTracker? = DiskWriteTracker()
  private val timesStarted = AtomicInteger(0)
  private val hasFailed = AtomicBoolean(false)

  /** Assigns this thread to store disk snapshots within this file with the name `test`. */
  fun startTest(test: String) {
    check(test.indexOf('/') == -1) { "Test name cannot contain '/', was $test" }
    assertNotTerminated()
    tests.updateAndGet { it.plusOrNoOp(test, WithinTestGC()) }
    system.startThreadLocal(this, test)
  }
  /**
   * Stops assigning this thread to store snapshots within this file at `test`, and if successful
   * marks that all other snapshots of this test can be pruned. A single test can be run multiple
   * times (as in `@ParameterizedTest`), and GC will only happen if all runs of the test are
   * successful.
   */
  fun finishedTestWithSuccess(test: String, success: Boolean) {
    assertNotTerminated()
    if (!success) {
      tests.get()[test]!!.keepAll()
    }
    system.finishThreadLocal(this, test)
  }
  private fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    diskWriteTracker = null // don't need this anymore
    val tests = tests.getAndUpdate { TERMINATED }
    require(tests !== TERMINATED) { "Snapshot $className already terminated!" }
    if (file != null) {
      val staleSnapshotIndices =
          WithinTestGC.findStaleSnapshotsWithin(
              file!!.snapshots, tests, findTestMethodsThatDidntRun(className, tests))
      if (staleSnapshotIndices.isNotEmpty() || file!!.wasSetAtTestTime) {
        file!!.removeAllIndices(staleSnapshotIndices)
        val snapshotPath = system.layout.snapshotPathForClass(className)
        if (file!!.snapshots.isEmpty()) {
          deleteFileAndParentDirIfEmpty(snapshotPath)
        } else {
          system.markPathAsWritten(system.layout.snapshotPathForClass(className))
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
        val snapshotFile = system.layout.snapshotPathForClass(className)
        deleteFileAndParentDirIfEmpty(snapshotFile)
      }
    }
    // now that we are done, allow our contents to be GC'ed
    file = null
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
    diskWriteTracker!!.record(key, snapshot, callStack, layout)
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
    if (file == null) {
      val snapshotPath = system.layout.snapshotPathForClass(className).toPath()
      file =
          if (Files.exists(snapshotPath) && Files.isRegularFile(snapshotPath)) {
            val content = Files.readAllBytes(snapshotPath)
            SnapshotFile.parse(SnapshotValueReader.of(content))
          } else {
            SnapshotFile.createEmptyWithUnixNewlines(system.layout.unixNewlines)
          }
    }
    return file!!
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
