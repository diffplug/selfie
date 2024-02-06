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
actual fun <T> atomic(initial: T): AtomicRef<T> = AtomicRef(initial)

actual class AtomicRef<T>(private var value: T) {
  actual fun get() = value
  actual fun updateAndGet(update: (T) -> T): T {
    value = update(value)
    return value
  }
  actual fun getAndUpdate(update: (T) -> T): T {
    val oldValue = value
    value = update(value)
    return oldValue
  }
}
val Lock = ReentrantLock()
actual inline fun reentrantLock() = Lock

@Suppress("NOTHING_TO_INLINE")
actual class ReentrantLock {
  actual inline fun lock(): Unit {}
  actual inline fun tryLock() = true
  actual inline fun unlock(): Unit {}
}
actual inline fun <T> ReentrantLock.withLock(block: () -> T) = block()
