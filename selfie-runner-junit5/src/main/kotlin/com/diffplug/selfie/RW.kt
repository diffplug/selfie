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

/**
 * Determines whether Selfie is overwriting snapshots or erroring-out on mismatch.
 * - by default, Selfie will overwrite snapshots (both `.ss` files and inline literals)
 * - if there is an environment variable or system property named `ci` or `CI`, then Selfie is
 *   read-only and errors out on a snapshot mismatch
 * - if there is an environment variable or system property named `selfie` or `SELFIE`, its value
 *   should be either `read` or `write`, and that will override all previous behaviors
 */
object RW {
  private fun lowercaseFromEnvOrSys(key: String): String? {
    return System.getenv(key)?.lowercase() ?: System.getProperty(key)?.lowercase()
  }
  private fun calcIsWrite(): Boolean {
    val override = lowercaseFromEnvOrSys("selfie") ?: lowercaseFromEnvOrSys("SELFIE")
    if (override != null) {
      return when (override) {
        "read" -> false
        "write" -> true
        else ->
            throw IllegalArgumentException(
                "Expected 'selfie' to be 'read' or 'write', but was '$override'")
      }
    }
    val ci = lowercaseFromEnvOrSys("ci") ?: lowercaseFromEnvOrSys("CI")
    return ci == null
  }
  val isWrite = calcIsWrite()
}
