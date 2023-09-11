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
 * A CharSequence which can efficiently subdivide and append itself.
 *
 * Equal only to other PoolString with the same `toString()`. Use [.sameAs] to compare with other
 * kinds of [CharSequence].
 *
 * Would be cool to have PoolString.Root which differentiates the String-based ones from
 * StringBuilder-based ones.
 */
actual fun groupImpl(slice: Slice, matchResult: MatchResult, group: Int): Slice {
  val group = matchResult.groups[group]!!
  return slice.subSequence(group.range.start, group.range.endInclusive - 1)
}
