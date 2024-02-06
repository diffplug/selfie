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
package com.diffplug.selfie.guts

import java.util.concurrent.atomic.AtomicReference
actual fun <T> atomic(initial: T): AtomicRef<T> = AtomicRef(initial)

actual class AtomicRef<T>(value: T) {
  val ref = AtomicReference(value)
  actual fun get() = ref.get()
  actual fun updateAndGet(update: (T) -> T): T = ref.updateAndGet(update)
  actual fun getAndUpdate(update: (T) -> T) = ref.getAndUpdate(update)
}
actual inline fun reentrantLock() = ReentrantLock()

actual typealias ReentrantLock = java.util.concurrent.locks.ReentrantLock
actual inline fun <T> ReentrantLock.withLock(block: () -> T): T {
  lock()
  try {
    return block()
  } finally {
    unlock()
  }
}
