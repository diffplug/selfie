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

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.RW
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.SnapshotFile
import org.junit.platform.engine.TestExecutionResult
import org.junit.platform.launcher.TestExecutionListener
import org.junit.platform.launcher.TestIdentifier
import org.junit.platform.launcher.TestPlan

/** Routes between `toMatchDisk()` calls and the snapshot file / pruning machinery. */
internal object Router {
  private class ClassMethod(val clazz: ClassProgress, val method: String)
  private val threadCtx = ThreadLocal<ClassMethod?>()
  fun readOrWrite(snapshot: Snapshot, sub: String?): Snapshot? {
    val suffix = if (sub == null) "" else "/$sub"
    val classMethod =
        threadCtx.get()
            ?: throw AssertionError(
                "Selfie `toMatchDisk` must be called only on the original thread.")
    return if (RW.isWrite) {
      classMethod.clazz.write(classMethod.method, suffix, snapshot)
      snapshot
    } else {
      classMethod.clazz.read(classMethod.method, suffix)
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
}

/** Tracks the progress of test runs within a single class, so that snapshots can be pruned. */
internal class ClassProgress(val className: String) {
  companion object {
    val TERMINATED =
        ArrayMap.empty<String, SnapshotMethodPruner>()
            .plus(" ~ f!n1shed ~ ", SnapshotMethodPruner())
  }
  private fun assertNotTerminated() {
    assert(methods !== TERMINATED) { "Cannot call methods on a terminated ClassProgress" }
  }

  private var file: SnapshotFile? = null
  private var methods = ArrayMap.empty<String, SnapshotMethodPruner>()
  // the methods below called by the TestExecutionListener on its runtime thread
  @Synchronized fun startMethod(method: String) {
    assertNotTerminated()
    Router.start(this, method)
    assert(method.indexOf('/') == -1) { "Method name cannot contain '/', was $method" }
    methods = methods.plus(method, SnapshotMethodPruner())
  }
  @Synchronized fun finishedMethodWithSuccess(method: String, success: Boolean) {
    assertNotTerminated()
    Router.finish(this, method)
    if (success) {
      methods[method]!!.succeeded()
    }
  }
  @Synchronized fun finishedClassWithSuccess(success: Boolean) {
    assertNotTerminated()
    SnapshotMethodPruner.prune(className, read().snapshots, methods, success)
    // write the file to disk
    TODO("write the file to disk if necessary")
    // now that we are done, allow our contents to be GC'ed
    methods = TERMINATED
    file = null
  }
  // the methods below are called from the test thread for I/O on snapshots
  @Synchronized fun keep(method: String, scenario: String) {
    assertNotTerminated()
    methods[method]!!.keep(scenario)
  }
  @Synchronized fun write(method: String, suffix: String, snapshot: Snapshot) {
    assertNotTerminated()
    methods[method]!!.keep(suffix)
    read().set("$method$suffix", snapshot)
  }
  @Synchronized fun read(
      method: String,
      suffix: String,
  ): Snapshot? {
    assertNotTerminated()
    methods[method]!!.keep(suffix)
    return read().snapshots[suffix]
  }
  private fun read(): SnapshotFile {
    if (file == null) {
      file = TODO()
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
  var layout: SelfieLayout? = null
  var usageByClass = ArrayMap.empty<String, ClassProgress>()
  private fun forClass(className: String) = synchronized(this) { usageByClass[className]!! }

  // TestExecutionListener
  fun start(className: String, method: String?) {
    if (method == null) {
      synchronized(this) { usageByClass = usageByClass.plus(className, ClassProgress(className)) }
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
    forClass(className)?.let {
      if (method != null) {
        it.finishedMethodWithSuccess(method, isSuccess)
      } else {
        it.finishedClassWithSuccess(isSuccess)
      }
    }
  }
  fun pruneSnapshotFiles() {
    // TODO: use SnapshotFilePruner
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
    val (clazz, method) = parseClassMethod(testIdentifier)
    progress.finishWithSuccess(
        clazz, method, testExecutionResult.status == TestExecutionResult.Status.SUCCESSFUL)
  }
  override fun testPlanExecutionFinished(testPlan: TestPlan?) {
    progress.pruneSnapshotFiles()
  }
  private fun isRoot(testIdentifier: TestIdentifier) = testIdentifier.parentId.isEmpty
  private fun parseClassMethod(testIdentifier: TestIdentifier): Pair<String, String?> {
    val display = testIdentifier.displayName
    val pieces = display.split('#')
    assert(pieces.size == 1 || pieces.size == 2) {
      "Expected 1 or 2 pieces, but got ${pieces.size} for $display"
    }
    return if (pieces.size == 1) Pair(pieces[0], null) else Pair(pieces[0], pieces[1])
  }
}
