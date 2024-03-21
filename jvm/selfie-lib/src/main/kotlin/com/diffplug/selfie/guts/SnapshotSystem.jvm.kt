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
  val placesToLook =
      listOf(
          "com.diffplug.selfie.junit5.SnapshotSystemJUnit5",
          "com.diffplug.selfie.kotest.SelfieExtension")
  val classesThatExist =
      placesToLook.mapNotNull {
        try {
          Class.forName(it)
        } catch (e: ClassNotFoundException) {
          null
        }
      }
  if (classesThatExist.size > 1) {
    throw IllegalStateException(
        """
        Found multiple SnapshotStorage implementations: $classesThatExist
        Only one of these should be on your classpath, not both:
        - com.diffplug.spotless:selfie-runner-junit5
        - com.diffplug.spotless:selfie-runner-kotest
        """
            .trimIndent())
  } else if (classesThatExist.isEmpty()) {
    throw IllegalStateException(
        "Missing required artifact `com.diffplug.spotless:selfie-runner-junit5 or com.diffplug.spotless:selfie-runner-kotest")
  }
  return classesThatExist.get(0).getMethod("initStorage").invoke(null) as SnapshotSystem
}
