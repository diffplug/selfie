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

import com.diffplug.selfie.SelfieRouting
import com.diffplug.selfie.SnapshotFile
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.BeforeAllCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtensionContext

class SelfieExtension : BeforeAllCallback, AfterAllCallback, BeforeEachCallback {
  override fun beforeAll(context: ExtensionContext) {
    // TOOD: load the selfie file if it exists
    // TODO: create the selfie metadata if necessary
    SelfieRouting.currentFile = SnapshotFile()
  }
  override fun beforeEach(context: ExtensionContext) {
    SelfieRouting.currentDiskPrefix = context.testMethod.get().name
  }
  override fun afterAll(context: ExtensionContext) {
    // TODO: test/prune orphan snapshots
    SelfieRouting.currentDiskPrefix = null
    SelfieRouting.currentFile = null
  }
}
