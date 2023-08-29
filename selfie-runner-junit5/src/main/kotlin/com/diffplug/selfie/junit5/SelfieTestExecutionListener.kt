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

import com.diffplug.selfie.*
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import org.junit.platform.engine.TestExecutionResult
import org.junit.platform.engine.support.descriptor.ClassSource
import org.junit.platform.engine.support.descriptor.MethodSource
import org.junit.platform.launcher.TestExecutionListener
import org.junit.platform.launcher.TestIdentifier
import org.junit.platform.launcher.TestPlan

/** Routes between `toMatchDisk()` calls and the snapshot file / pruning machinery. */
internal object Router {
  private class ClassMethod(val clazz: ClassProgress, val method: String)
  private val threadCtx = ThreadLocal<ClassMethod?>()
  fun readOrWriteOrKeep(snapshot: Snapshot?, subOrKeepAll: String?): Snapshot? {
    val classMethod =
        threadCtx.get()
            ?: throw AssertionError(
                "Selfie `toMatchDisk` must be called only on the original thread.")
    return if (subOrKeepAll == null) {
      assert(snapshot == null)
      classMethod.clazz.keep(classMethod.method, null)
      null
    } else {
      val suffix = if (subOrKeepAll == "") "" else "/$subOrKeepAll"
      if (snapshot == null) {
        classMethod.clazz.keep(classMethod.method, suffix)
        null
      } else {
        if (RW.isWrite) {
          classMethod.clazz.write(classMethod.method, suffix, snapshot)
          snapshot
        } else {
          classMethod.clazz.read(classMethod.method, suffix)
        }
      }
    }
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
  fun fileLocationFor(className: String): Path {
    if (layout == null) {
      layout = SnapshotFileLayout.initialize(className)
    }
    return layout!!.snapshotPathForClass(className)
  }

  var layout: SnapshotFileLayout? = null
}

/** Tracks the progress of test runs within a single class, so that snapshots can be pruned. */
internal class ClassProgress(val className: String) {
  companion object {
    val TERMINATED =
        ArrayMap.empty<String, MethodSnapshotGC>().plus(" ~ f!n1shed ~ ", MethodSnapshotGC())
  }
  private fun assertNotTerminated() {
    assert(methods !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file: SnapshotFile? = null
  private var methods = ArrayMap.empty<String, MethodSnapshotGC>()
  // the methods below called by the TestExecutionListener on its runtime thread
  @Synchronized fun startMethod(method: String) {
    assertNotTerminated()
    Router.start(this, method)
    assert(method.indexOf('/') == -1) { "Method name cannot contain '/', was $method" }
    methods = methods.plus(method, MethodSnapshotGC())
  }
  @Synchronized fun finishedMethodWithSuccess(method: String, success: Boolean) {
    assertNotTerminated()
    Router.finish(this, method)
    methods[method]!!.succeeded(success)
  }
  @Synchronized fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    if (file != null) {
      val staleSnapshotIndices =
          MethodSnapshotGC.findStaleSnapshotsWithin(className, file!!.snapshots, methods)
      if (staleSnapshotIndices.isNotEmpty() || file!!.wasSetAtTestTime) {
        file!!.removeAllIndices(staleSnapshotIndices)
        val snapshotPath = Router.fileLocationFor(className)
        if (file!!.snapshots.isEmpty()) {
          deleteFileAndParentDirIfEmpty(snapshotPath)
        } else {
          Files.createDirectories(snapshotPath.parent)
          Files.newBufferedWriter(snapshotPath, StandardCharsets.UTF_8).use { writer ->
            file!!.serialize(writer::write)
          }
        }
      }
    } else {
      // we never read or wrote to the file
      val isStale = MethodSnapshotGC.isUnusedSnapshotFileStale(className, methods, success)
      if (isStale) {
        val snapshotFile = Router.fileLocationFor(className)
        deleteFileAndParentDirIfEmpty(snapshotFile)
      }
    }
    // now that we are done, allow our contents to be GC'ed
    methods = TERMINATED
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
  @Synchronized fun write(method: String, suffix: String, snapshot: Snapshot) {
    assertNotTerminated()
    methods[method]!!.keepSuffix(suffix)
    read().setAtTestTime("$method$suffix", snapshot)
  }
  @Synchronized fun read(
      method: String,
      suffix: String,
  ): Snapshot? {
    assertNotTerminated()
    val snapshot = read().snapshots["$method$suffix"]
    if (snapshot != null) {
      methods[method]!!.keepSuffix(suffix)
    }
    return snapshot
  }
  private fun read(): SnapshotFile {
    if (file == null) {
      val snapshotPath = Router.fileLocationFor(className)
      file =
          if (Files.exists(snapshotPath) && Files.isRegularFile(snapshotPath)) {
            val content = Files.readAllBytes(snapshotPath)
            SnapshotFile.parse(SnapshotValueReader.of(content))
          } else {
            SnapshotFile.createEmptyWithUnixNewlines(Router.layout!!.unixNewlines)
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
  private var progressPerClass = ArrayMap.empty<String, ClassProgress>()
  private fun forClass(className: String) = synchronized(this) { progressPerClass[className]!! }

  // TestExecutionListener
  fun start(className: String, method: String?) {
    if (method == null) {
      synchronized(this) {
        progressPerClass = progressPerClass.plus(className, ClassProgress(className))
      }
    } else {
      forClass(className).startMethod(method)
    }
  }
  fun skip(className: String, method: String?) {
    if (method == null) {
      start(className, null)
      finishWithSuccess(className, null, false)
    } else {
      // thanks to reflection, we don't have to rely on method skip events
    }
  }
  fun finishWithSuccess(className: String, method: String?, isSuccess: Boolean) {
    forClass(className).let {
      if (method != null) {
        it.finishedMethodWithSuccess(method, isSuccess)
      } else {
        it.finishedClassWithSuccess(isSuccess)
      }
    }
  }
  fun finishedAllTests() {
    Router.layout?.let { layout ->
      for (stale in findStaleSnapshotFiles(layout)) {
        deleteFileAndParentDirIfEmpty(layout.snapshotPathForClass(stale))
      }
    }
  }
}
/** This is automatically registered at runtime thanks to `META-INF/services`. */
class SelfieTestExecutionListener : TestExecutionListener {
  private val progress = Progress()
  override fun executionStarted(testIdentifier: TestIdentifier) {
    if (isRoot(testIdentifier)) return
    val (clazz, method) = parseClassMethod(testIdentifier)
    progress.start(clazz, method)
  }
  override fun executionSkipped(testIdentifier: TestIdentifier, reason: String) {
    val (clazz, method) = parseClassMethod(testIdentifier)
    progress.skip(clazz, method)
  }
  override fun executionFinished(
      testIdentifier: TestIdentifier,
      testExecutionResult: TestExecutionResult
  ) {
    if (isRoot(testIdentifier)) return
    val (clazz, method) = parseClassMethod(testIdentifier)
    progress.finishWithSuccess(
        clazz, method, testExecutionResult.status == TestExecutionResult.Status.SUCCESSFUL)
  }
  override fun testPlanExecutionFinished(testPlan: TestPlan?) {
    progress.finishedAllTests()
  }
  private fun isRoot(testIdentifier: TestIdentifier) = testIdentifier.parentId.isEmpty
  private fun parseClassMethod(testIdentifier: TestIdentifier): Pair<String, String?> {
    return when (val source = testIdentifier.source.get()) {
      is ClassSource -> Pair(source.className, null)
      is MethodSource -> Pair(source.className, source.methodName)
      else -> throw AssertionError("Unexpected source $source")
    }
  }
}
private fun deleteFileAndParentDirIfEmpty(snapshotFile: Path) {
  if (Files.isRegularFile(snapshotFile)) {
    Files.delete(snapshotFile)
    // if the parent folder is now empty, delete it
    val parent = snapshotFile.parent!!
    if (Files.list(parent).use { !it.findAny().isPresent }) {
      Files.delete(parent)
    }
  }
}
