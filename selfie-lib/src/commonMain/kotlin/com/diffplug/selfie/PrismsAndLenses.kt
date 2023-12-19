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
package com.diffplug.selfie

@OptIn(ExperimentalStdlibApi::class)
interface SnapshotLens : AutoCloseable {
  val defaultLensName: String
  fun transform(testClass: String, key: String, snapshot: Snapshot): SnapshotValue?
  override fun close() {}
}

@OptIn(ExperimentalStdlibApi::class)
interface SnapshotPrism : AutoCloseable {
  fun transform(className: String, key: String, snapshot: Snapshot): Snapshot
  override fun close() {}
}
fun interface SnapshotPredicate {
  fun test(testClass: String, key: String, snapshot: Snapshot): Boolean
}
