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

/**
 * Determines whether Selfie is overwriting snapshots or erroring-out on mismatch.
 * - by default, Selfie will overwrite snapshots (both `.ss` files and inline literals)
 * - if environment variable or system property named `ci` or `CI` with value `true` or `TRUE`
 *     - then Selfie is read-only and errors out on a snapshot mismatch
 * - if environment variable or system property named `selfie` or `SELFIE`
 *     - its value should be either `read`, `write`, or `writeonce` (case-insensitive)
 *     - `write` allows a single snapshot to be set multiple times within a test, so long as it is
 *       the same value. `writeonce` errors as soon as a snapshot is set twice even to the same
 *       value.
 *     - selfie, if set, will override the presence of `CI`
 */
internal enum class RW {
  read,
  write;

  companion object {
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
    private fun calcRW(): RW {
      val override = lowercaseFromEnvOrSys("selfie") ?: lowercaseFromEnvOrSys("SELFIE")
      if (override != null) {
        return RW.valueOf(override)
      }
      val ci = lowercaseFromEnvOrSys("ci") ?: lowercaseFromEnvOrSys("CI")
      return if (ci == "true") read else write
    }
    val mode = calcRW()
    val isWrite = mode != read
  }
}
