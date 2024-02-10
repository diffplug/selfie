/*
 * Copyright (C) 2024 DiffPlug
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
package com.diffplug.selfie.kotest

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.ArraySet
import com.diffplug.selfie.Mode
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SnapshotFile
import com.diffplug.selfie.SnapshotValueReader
import com.diffplug.selfie.guts.CallStack
import com.diffplug.selfie.guts.CommentTracker
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.DiskWriteTracker
import com.diffplug.selfie.guts.InlineWriteTracker
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotFileLayout
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.SourceFile
import com.diffplug.selfie.guts.TypedPath
import com.diffplug.selfie.guts.WithinTestGC
import com.diffplug.selfie.guts.atomic
import kotlin.jvm.JvmStatic

internal object SnapshotSystemKotest : SnapshotSystem {
  @JvmStatic fun initStorage(): SnapshotSystem = this
  override val fs = FSOkio
  override val mode = calcMode()
  override val layout = SnapshotFileLayoutKotest(SelfieSettingsAPI.initialize(), fs)
  private val commentTracker = CommentTracker()
  private val inlineWriteTracker = InlineWriteTracker()
  private val progressPerFile = atomic(ArrayMap.empty<String, SnapshotFileProgress>())
  fun forClassOrFilename(classOrFilename: String): SnapshotFileProgress {
    // optimize for reads
    progressPerFile.get()[classOrFilename]?.let {
      return it
    }
    // sometimes we'll have to write
    return progressPerFile
        .updateAndGet {
          it.plusOrNoOp(classOrFilename, SnapshotFileProgress(this, classOrFilename))
        }[classOrFilename]!!
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
  override fun diskThreadLocal(): DiskStorage = TODO("THREADING GUIDE (TODO)")
  fun finishedAllTests() {
    val snapshotsFilesWrittenToDisk =
        checkForInvalidStale.getAndUpdate { null }
            ?: throw AssertionError("finishedAllTests() was called more than once.")

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
      val staleFile = layout.snapshotPathForClassOrFilename(stale)
      if (snapshotsFilesWrittenToDisk.contains(staleFile)) {
        throw AssertionError(
            "Selfie wrote a snapshot and then marked it stale for deletion in the same run: $staleFile\nSelfie will delete this snapshot on the next run, which is bad! Why is Selfie marking this snapshot as stale?")
      } else {
        deleteFileAndParentDirIfEmpty(staleFile)
      }
    }
  }
}

internal data class DiskStorageKotest(val file: SnapshotFileProgress, val test: String) :
    DiskStorage, Comparable<DiskStorageKotest> {
  override fun readDisk(sub: String, call: CallStack): Snapshot? = file.read(test, suffix(sub))
  override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) {
    file.write(test, suffix(sub), actual, call, file.system.layout)
  }
  override fun keep(subOrKeepAll: String?) {
    file.keep(test, subOrKeepAll?.let { suffix(it) })
  }
  private fun suffix(sub: String) = if (sub == "") "" else "/$sub"
  override fun compareTo(other: DiskStorageKotest): Int =
      compareValuesBy(this, other, { it.file.classOrFilename }, { it.test })
  override fun toString(): String = "${file.classOrFilename}#$test"
}

/**
 * Tracks the progress of test runs within a single disk snapshot file, so that snapshots can be
 * pruned.
 */
internal class SnapshotFileProgress(val system: SnapshotSystemKotest, val classOrFilename: String) {
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

  /** Assigns this thread to store disk snapshots within this file with the name `test`. */
  fun startTest(test: String) {
    check(test.indexOf('/') == -1) { "Test name cannot contain '/', was $test" }
    assertNotTerminated()
    tests.updateAndGet { it.plusOrNoOp(test, WithinTestGC()) }
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
  }
  fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    diskWriteTracker = null // don't need this anymore
    val tests = tests.getAndUpdate { TERMINATED }
    require(tests !== TERMINATED) { "Snapshot $classOrFilename already terminated!" }
    if (file != null) {
      val staleSnapshotIndices =
          WithinTestGC.findStaleSnapshotsWithin(
              file!!.snapshots, tests, findTestMethodsThatDidntRun(classOrFilename, tests))
      if (staleSnapshotIndices.isNotEmpty() || file!!.wasSetAtTestTime) {
        file!!.removeAllIndices(staleSnapshotIndices)
        val snapshotPath = system.layout.snapshotPathForClassOrFilename(classOrFilename)
        if (file!!.snapshots.isEmpty()) {
          deleteFileAndParentDirIfEmpty(snapshotPath)
        } else {
          system.markPathAsWritten(system.layout.snapshotPathForClassOrFilename(classOrFilename))
          FS_SYSTEM.createDirectories(snapshotPath.toPath().parent!!)
          FS_SYSTEM.write(snapshotPath.toPath()) {
            val sink = this
            file!!.serialize(
                object : Appendable {
                  override fun append(value: CharSequence?): Appendable {
                    value?.let { sink.writeUtf8(it.toString()) }
                    return this
                  }
                  override fun append(
                      value: CharSequence?,
                      startIndex: Int,
                      endIndex: Int
                  ): Appendable {
                    value?.let { sink.writeUtf8(it.subSequence(startIndex, endIndex).toString()) }
                    return this
                  }
                  override fun append(value: Char): Appendable {
                    sink.writeUtf8(value.toString())
                    return this
                  }
                })
          }
        }
      }
    } else {
      // we never read or wrote to the file
      val everyTestInClassRan = findTestMethodsThatDidntRun(classOrFilename, tests).none()
      val isStale =
          everyTestInClassRan && success && tests.values.all { it.succeededAndUsedNoSnapshots() }
      if (isStale) {
        val snapshotFile = system.layout.snapshotPathForClassOrFilename(classOrFilename)
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
      val snapshotPath = system.layout.snapshotPathForClassOrFilename(classOrFilename).toPath()
      file =
          if (FS_SYSTEM.metadataOrNull(snapshotPath)?.isRegularFile == true) {
            val content = FS_SYSTEM.read(snapshotPath) { readByteArray() }
            SnapshotFile.parse(SnapshotValueReader.of(content))
          } else {
            SnapshotFile.createEmptyWithUnixNewlines(system.layout.unixNewlines)
          }
    }
    return file!!
  }
}
private fun deleteFileAndParentDirIfEmpty(snapshotFile: TypedPath) {
  if (FS_SYSTEM.metadataOrNull(snapshotFile.toPath())?.isRegularFile == true) {
    FS_SYSTEM.delete(snapshotFile.toPath())
    // if the parent folder is now empty, delete it
    val parent = snapshotFile.toPath().parent!!
    if (FS_SYSTEM.list(parent).isEmpty()) {
      FS_SYSTEM.delete(parent)
    }
  }
}
internal fun findTestMethodsThatDidntRun(
    className: String,
    testsThatRan: ArrayMap<String, WithinTestGC>,
): Sequence<String> = sequenceOf()
internal fun findStaleSnapshotFiles(layout: SnapshotFileLayoutKotest): List<String> = listOf()
