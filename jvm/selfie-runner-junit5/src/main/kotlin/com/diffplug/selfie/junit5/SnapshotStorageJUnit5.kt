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
    get() = classAndMethod().clazz.parent.layout

  private class ClassMethod(val clazz: ClassProgress, val method: String)
  private val threadCtx = ThreadLocal<ClassMethod?>()
  private fun classAndMethod() =
      threadCtx.get()
          ?: throw AssertionError(
              "Selfie `toMatchDisk` must be called only on the original thread.")
  override fun sourceFileHasWritableComment(call: CallStack): Boolean {
    val cm = classAndMethod()
    return cm.clazz.parent.commentTracker!!.hasWritableComment(call, cm.clazz.parent.layout)
  }
  private fun suffix(sub: String) = if (sub == "") "" else "/$sub"
  override fun readDisk(sub: String, call: CallStack): Snapshot? {
    val cm = classAndMethod()
    val suffix = suffix(sub)
    return cm.clazz.read(cm.method, suffix)
  }
  override fun writeDisk(actual: Snapshot, sub: String, call: CallStack) {
    val cm = classAndMethod()
    val suffix = suffix(sub)
    cm.clazz.write(cm.method, suffix, actual, call, cm.clazz.parent.layout)
  }
  override fun keep(subOrKeepAll: String?) {
    val cm = classAndMethod()
    if (subOrKeepAll == null) {
      cm.clazz.keep(cm.method, null)
    } else {
      cm.clazz.keep(cm.method, suffix(subOrKeepAll))
    }
  }
  override fun writeInline(literalValue: LiteralValue<*>, call: CallStack) {
    val cm =
        threadCtx.get()
            ?: throw AssertionError("Selfie `toBe` must be called only on the original thread.")
    cm.clazz.writeInline(call, literalValue, cm.clazz.parent.layout)
  }
  internal fun start(clazz: ClassProgress, method: String) {
    val current = threadCtx.get()
    check(current == null) {
      "THREAD ERROR: ${current!!.clazz.className}#${current.method} is in progress, cannot start $clazz#$method"
    }
    threadCtx.set(ClassMethod(clazz, method))
  }
  internal fun finish(clazz: ClassProgress, method: String) {
    val current = threadCtx.get()
    check(current != null) {
      "THREAD ERROR: no method is in progress, cannot finish $clazz#$method"
    }
    check(current.clazz == clazz && current.method == method) {
      "THREAD ERROR: ${current.clazz.className}#${current.method} is in progress, cannot finish ${clazz.className}#$method"
    }
    threadCtx.set(null)
  }
}

/** Tracks the progress of test runs within a single class, so that snapshots can be pruned. */
internal class ClassProgress(val parent: Progress, val className: String) {
  companion object {
    val TERMINATED =
        ArrayMap.empty<String, MethodSnapshotGC>().plus(" ~ f!n1shed ~ ", MethodSnapshotGC())
  }
  private fun assertNotTerminated() {
    assert(methods !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file: SnapshotFile? = null
  private var methods = ArrayMap.empty<String, MethodSnapshotGC>()
  private var diskWriteTracker: DiskWriteTracker? = DiskWriteTracker()
  private var inlineWriteTracker: InlineWriteTracker? = InlineWriteTracker()
  // the methods below called by the TestExecutionListener on its runtime thread
  @Synchronized fun startMethod(method: String, isTest: Boolean) {
    assertNotTerminated()
    if (isTest) {
      SnapshotStorageJUnit5.start(this, method)
    }
    assert(method.indexOf('/') == -1) { "Method name cannot contain '/', was $method" }
    methods = methods.plusOrNoOp(method, MethodSnapshotGC())
  }
  @Synchronized fun finishedMethodWithSuccess(method: String, isTest: Boolean, success: Boolean) {
    assertNotTerminated()
    if (isTest) {
      SnapshotStorageJUnit5.finish(this, method)
    }
    if (!success) {
      methods[method]!!.keepAll()
    }
  }
  @Synchronized fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    if (inlineWriteTracker!!.hasWrites()) {
      inlineWriteTracker!!.persistWrites(parent.layout)
    }
    if (file != null) {
      val staleSnapshotIndices =
          MethodSnapshotGC.findStaleSnapshotsWithin(className, file!!.snapshots, methods)
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
      val isStale = MethodSnapshotGC.isUnusedSnapshotFileStale(className, methods, success)
      if (isStale) {
        val snapshotFile = parent.layout.snapshotPathForClass(className)
        deleteFileAndParentDirIfEmpty(snapshotFile)
      }
    }
    // now that we are done, allow our contents to be GC'ed
    methods = TERMINATED
    diskWriteTracker = null
    inlineWriteTracker = null
    file = null
  }
  // the methods below are called from the test thread for I/O on snapshots
  @Synchronized fun keep(method: String, suffixOrAll: String?) {
    assertNotTerminated()
    if (suffixOrAll == null) {
      methods[method]!!.keepAll()
    } else {
      methods[method]!!.keepSuffix(suffixOrAll)
    }
  }
  @Synchronized fun writeInline(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    inlineWriteTracker!!.record(call, literalValue, layout)
  }
  @Synchronized fun write(
      method: String,
      suffix: String,
      snapshot: Snapshot,
      callStack: CallStack,
      layout: SnapshotFileLayout
  ) {
    assertNotTerminated()
    val key = "$method$suffix"
    diskWriteTracker!!.record(key, snapshot, callStack, layout)
    methods[method]!!.keepSuffix(suffix)
    read().setAtTestTime(key, snapshot)
  }
  @Synchronized fun read(method: String, suffix: String): Snapshot? {
    assertNotTerminated()
    val snapshot = read().snapshots["$method$suffix"]
    if (snapshot != null) {
      methods[method]!!.keepSuffix(suffix)
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

  private var progressPerClass = ArrayMap.empty<String, ClassProgress>()
  private fun forClass(className: String) = synchronized(this) { progressPerClass[className]!! }

  // TestExecutionListener
  fun start(className: String, method: String?, isTest: Boolean) {
    if (method == null) {
      synchronized(this) {
        progressPerClass = progressPerClass.plus(className, ClassProgress(this, className))
      }
    } else {
      forClass(className).startMethod(method, isTest)
    }
  }
  fun skip(className: String, method: String?, isTest: Boolean) {
    if (method == null) {
      start(className, null, isTest)
      finishWithSuccess(className, null, isTest, false)
    } else {
      // thanks to reflection, we don't have to rely on method skip events
    }
  }
  fun finishWithSuccess(className: String, method: String?, isTest: Boolean, isSuccess: Boolean) {
    forClass(className).let {
      if (method != null) {
        it.finishedMethodWithSuccess(method, isTest, isSuccess)
      } else {
        it.finishedClassWithSuccess(isSuccess)
      }
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
