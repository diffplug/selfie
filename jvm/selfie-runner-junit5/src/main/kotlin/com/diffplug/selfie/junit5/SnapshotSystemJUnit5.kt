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
import com.diffplug.selfie.guts.atomic
import java.nio.charset.StandardCharsets
import java.nio.file.Files
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
  override val layout = SnapshotFileLayoutJUnit5(SelfieSettingsAPI.initialize(), fs)
  private val commentTracker = CommentTracker()
  private val inlineWriteTracker = InlineWriteTracker()
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
  override fun diskThreadLocal(): DiskStorage = diskThreadLocalTyped()
  fun finishedAllTests() {
    val snapshotsFilesWrittenToDisk =
        checkForInvalidStale.getAndUpdate { null }
            ?: throw AssertionError("finishedAllTests() was called more than once.")

    missingDownsErrorMsg()?.let { errorMsg -> throw AssertionError("THREAD ERROR: $errorMsg") }
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

  //////////
  // BEGIN crazy thread locals
  //
  // From here down to the "END crazy thread locals" is a weird section for solving this problem:
  // We have to tell `expectSelfie` calls which snapshot file to put their data into, and what
  // test name to prefix their snapshots with. We do that with a threadlocal which we set when we
  // are notified that the test will start.
  //
  // If a test is not started from the same thread where the framework notifies that it is starting,
  // then we're out of luck. Not sure how we could fix that. JUnit5, JUnit-vintage, and Kotest all
  // notify of start on the same thread as the test actually starts.
  //
  // JUnit5 and JUnit-vintage also notify of finish on that same thread, which makes it easy to be
  // sure that the thread locals are managed exactly. Kotest, on the other hand, notifies of
  // finish on a *different* thread. I think this is a workaround for some Gradle issue, and either
  // way it makes sense because Kotest supports async testing, every test can be a `suspend fun`.
  //
  // Because of this, it could be that for some thread T, we get notified of a test A starting on T,
  // and then we get notified of another test B which is starting on T, and later on we get
  // notified that A has finished.
  //
  // It's also important to note that a single `DiskStorageJUnit5` may be serving multiple tests
  // concurrently, e.g. in a `@ParameterizedTest`.
  //
  // To make all of this work, we have to maintain the following maps:
  private fun diskThreadLocalTyped(): DiskStorageJUnit5 =
      threadMap.get().get(Thread.currentThread().id)
          ?: throw AssertionError("THREADING GUIDE (TODO)")
  /** Map from threadId to a DiskStorage. */
  private val threadMap = AtomicReference(ArrayMap.empty<Long, DiskStorageJUnit5>())
  /** Map from a test's uniqueId to a threadId. */
  private val uniqueidToThread = AtomicReference(ArrayMap.empty<String, Long>())
  /**
   * Map from a `DiskStorage` to the number of `finishThreadLocal` calls we expect to happen where
   * the storage's initiating thread has already been used by some other test.
   */
  private val missingFinishes = AtomicReference(ArrayMap.empty<DiskStorageJUnit5, Int>())
  internal fun startThreadLocal(file: SnapshotFileProgress, test: String, uniqueId: String) {
    val threadId = Thread.currentThread().id
    val next = DiskStorageJUnit5(file, test)
    val prevMap = threadMap.getAndUpdate { it.plusOrNoOpOrReplace(threadId, next) }
    uniqueidToThread.getAndUpdate { it.plusOrNoOpOrReplace(uniqueId, threadId) }
    val prev = prevMap[threadId]
    if (prev != null) {
      //  now:      .
      // prev: /      \
      // next:    /     \
      missingFinish(prev, 1) // we expect prev will have 1 missing finish
    }
  }
  internal fun finishThreadLocal(file: SnapshotFileProgress, test: String, uniqueId: String) {
    val finishing = DiskStorageJUnit5(file, test)
    val threadId = Thread.currentThread().id
    val prevIdToThread = uniqueidToThread.getAndUpdate { it.minusOrNoOp(uniqueId) }
    val prevThreadId =
        prevIdToThread[uniqueId]
            ?: throw AssertionError(
                "Test $finishing($uniqueId) either a) never started or b) finished more than once.")
    if (threadId == prevThreadId) {
      // we got notified of finish on the same thread we started on, easy
      val prevMap = threadMap.getAndUpdate { it.minusOrNoOp(threadId, finishing) }
      val prev = prevMap[threadId]
      require(prev == finishing) {
        "Test $finishing($uniqueId) is ending on the same thread it started, but we found $prev in its spot unexpectedly."
      }
    } else {
      // we got notified on a different thread than we started (Kotest does this, maybe others
      // too)
      val prevMap = threadMap.getAndUpdate { it.minusOrNoOp(prevThreadId, finishing) }
      val prev = prevMap[prevThreadId]
      if (prev == finishing) {
        // This is the normal Kotest case, where the finish notification arrived before
        // the next test started.
      } else {
        // This is a predictable race condition, where a thread pool started a new test before
        // we got notified of the previous finish. It must be in the missingFinish map, which
        // can now be decremented
        missingFinish(finishing, -1)
      }
    }
  }
  private fun missingFinish(disk: DiskStorageJUnit5, delta: Int) {
    missingFinishes.updateAndGet {
      val existing = it[disk]
      if (existing == null) {
        require(delta > 0)
        it.plus(disk, delta)
      } else {
        val newValue = existing + delta
        if (newValue == 0) {
          it.minusOrNoOp(disk)
        } else {
          require(newValue > 0)
          it.plusOrNoOpOrReplace(disk, newValue)
        }
      }
    }
  }
  private fun missingDownsErrorMsg(): String? =
      missingFinishes
          .getAndUpdate { ArrayMap.empty() }
          .map { "${it.key} started ${it.value} more times than it finished" }
          .joinToString("\n")
          .ifEmpty { null }
  // END crazy thread locals
  //////////
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

  private var file: SnapshotFile? = null
  private val tests = atomic(ArrayMap.empty<String, WithinTestGC>())
  private var diskWriteTracker: DiskWriteTracker? = DiskWriteTracker()
  private val timesStarted = AtomicInteger(0)
  private val hasFailed = AtomicBoolean(false)

  /** Assigns this thread to store disk snapshots within this file with the name `test`. */
  fun startTest(test: String, uniqueId: String?) {
    check(test.indexOf('/') == -1) { "Test name cannot contain '/', was $test" }
    assertNotTerminated()
    tests.updateAndGet { it.plusOrNoOp(test, WithinTestGC()) }
    uniqueId?.let { system.startThreadLocal(this, test, uniqueId) }
  }
  /**
   * Stops assigning this thread to store snapshots within this file at `test`, and if successful
   * marks that all other snapshots of this test can be pruned. A single test can be run multiple
   * times (as in `@ParameterizedTest`), and GC will only happen if all runs of the test are
   * successful.
   */
  fun finishedTestWithSuccess(test: String, uniqueId: String?, success: Boolean) {
    assertNotTerminated()
    if (!success) {
      tests.get()[test]!!.keepAll()
    }
    uniqueId?.let { system.finishThreadLocal(this, test, uniqueId) }
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
