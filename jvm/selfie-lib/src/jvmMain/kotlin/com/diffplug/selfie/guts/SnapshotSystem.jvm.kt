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
package com.diffplug.selfie.guts
actual fun initSnapshotSystem(): SnapshotSystem {
  try {
    val clazz = Class.forName("com.diffplug.selfie.junit5.SnapshotSystemJUnit5")
    return clazz.getMethod("initStorage").invoke(null) as SnapshotSystem
  } catch (e: ClassNotFoundException) {
    throw IllegalStateException(
        "Missing required artifact `com.diffplug.spotless:selfie-runner-junit5", e)
  }
}
