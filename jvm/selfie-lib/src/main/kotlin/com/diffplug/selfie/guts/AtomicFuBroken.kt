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

expect class AtomicRef<T> {
  fun get(): T
  fun updateAndGet(update: (T) -> T): T
  fun getAndUpdate(update: (T) -> T): T
}

/** Replace with atomicfu when stable. */
expect fun <T> atomic(initial: T): AtomicRef<T>

expect fun reentrantLock(): ReentrantLock

expect class ReentrantLock {
  fun lock(): Unit
  fun tryLock(): Boolean
  fun unlock(): Unit
}

expect inline fun <T> ReentrantLock.withLock(block: () -> T): T
