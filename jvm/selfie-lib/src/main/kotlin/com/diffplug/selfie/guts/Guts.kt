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

import com.diffplug.selfie.ArrayMap
import com.diffplug.selfie.ArraySet
import com.diffplug.selfie.Mode
import com.diffplug.selfie.Snapshot
import com.diffplug.selfie.efficientReplace
import java.util.concurrent.atomic.AtomicReference
import java.util.stream.Collectors
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.math.abs

private const val UNKNOWN_METHOD = "<unknown>"
private const val TRIPLE_QUOTE = "\"\"\""
private const val KOTLIN_DOLLAR = "\${'\$'}"
private const val KOTLIN_DOLLARQUOTE = "\${'\"'}"

/** Represents the line at which user code called into Selfie. */
data class CallLocation(
    val clazz: String,
    val method: String,
    val fileName: String?,
    val line: Int
) : Comparable<CallLocation> {
  fun withLine(line: Int): CallLocation = CallLocation(clazz, UNKNOWN_METHOD, fileName, line)
  fun samePathAs(other: CallLocation): Boolean = clazz == other.clazz && fileName == other.fileName
  override fun compareTo(other: CallLocation): Int =
      compareValuesBy(this, other, { it.clazz }, { it.method }, { it.fileName }, { it.line })

  /**
   * If the runtime didn't give us the filename, guess it from the class, and try to find the source
   * file by walking the CWD. If we don't find it, report it as a `.class` file.
   */
  private fun findFileIfAbsent(layout: SnapshotFileLayout): String {
    if (fileName != null) {
      return fileName
    }
    return layout.sourcePathForCallMaybe(this)?.let { it.name }
        ?: "${clazz.substringAfterLast('.')}.class"
  }

  /** A `toString` which an IDE will render as a clickable link. */
  fun ideLink(layout: SnapshotFileLayout): String =
      "$clazz.$method(${findFileIfAbsent(layout)}:$line)"
  /** Returns the likely name of the sourcecode of this file, without path or extension. */
  fun sourceFilenameWithoutExtension(): String = clazz.substringAfterLast('.').substringBefore('$')
}

/** Generates a CallLocation and the CallStack behind it. */
internal fun recordCall(callerFileOnly: Boolean): CallStack =
    StackWalker.getInstance().walk { frames ->
      val framesWithDrop = frames.dropWhile { it.className.startsWith("com.diffplug.selfie") }
      if (callerFileOnly) {
        val caller =
            framesWithDrop
                .limit(1)
                .map { CallLocation(it.className, UNKNOWN_METHOD, it.fileName, -1) }
                .findFirst()
                .get()
        CallStack(caller, emptyList())
      } else {
        val fullStack =
            framesWithDrop
                .map { CallLocation(it.className, it.methodName, it.fileName, it.lineNumber) }
                .collect(Collectors.toList())
        CallStack(fullStack.get(0), fullStack.subList(1, fullStack.size))
      }
    }

/** Represents the callstack above a given CallLocation. */
class CallStack(val location: CallLocation, val restOfStack: List<CallLocation>) {
  fun ideLink(layout: SnapshotFileLayout) =
      sequence {
            yield(location)
            yieldAll(restOfStack)
          }
          .joinToString("\n") { it.ideLink(layout) }
}

/** The first write at a given spot. */
internal class FirstWrite<T>(val snapshot: T, val callStack: CallStack)

/** For tracking the writes of disk snapshots literals. */
sealed class WriteTracker<K : Comparable<K>, V> {
  internal val writes = atomic(ArrayMap.empty<K, FirstWrite<V>>())
  protected fun recordInternal(key: K, snapshot: V, call: CallStack, layout: SnapshotFileLayout) {
    val thisWrite = FirstWrite(snapshot, call)
    val possiblyUnchangedMap = writes.updateAndGet { it.plusOrNoOp(key, thisWrite) }
    val existing = possiblyUnchangedMap[key]!!
    if (existing === thisWrite) {
      // we were the first write
      return
    }
    // we were not the first write
    layout.checkForSmuggledError()
    val howToFix =
        when (this) {
          is DiskWriteTracker ->
              "You can fix this with `.toMatchDisk(String sub)` and pass a unique value for sub."
          is InlineWriteTracker ->
              """
          You can fix this by doing an `if` before the assertion to separate the cases, e.g.
            if (isWindows) {
              expectSelfie(underTest).toBe("C:\\")
            } else {
              expectSelfie(underTest).toBe("bash$")
            }
        """
          is ToBeFileWriteTracker ->
              "You can fix this with `.toBeFile(String filename)` and pass a unique filename for each code path."
        }
    if (existing.snapshot != snapshot) {
      throw layout.fs.assertFailed(
          "Snapshot was set to multiple values!\n  first time: ${existing.callStack.location.ideLink(layout)}\n   this time: ${call.location.ideLink(layout)}\n$howToFix",
          existing.snapshot,
          snapshot)
    } else if (!layout.allowMultipleEquivalentWritesToOneLocation) {
      throw layout.fs.assertFailed(
          "Snapshot was set to the same value multiple times.\n$howToFix",
          existing.callStack.ideLink(layout),
          call.ideLink(layout))
    }
  }
}

class DiskWriteTracker : WriteTracker<String, Snapshot>() {
  fun record(key: String, snapshot: Snapshot, call: CallStack, layout: SnapshotFileLayout) {
    recordInternal(key, snapshot, call, layout)
  }
}

class ToBeFileWriteTracker : WriteTracker<TypedPath, ToBeFileLazyBytes>() {
  fun writeToDisk(
      key: TypedPath,
      snapshot: ByteArray,
      call: CallStack,
      layout: SnapshotFileLayout
  ) {
    val lazyBytes = ToBeFileLazyBytes(key, layout, snapshot)
    recordInternal(key, lazyBytes, call, layout)
    // recordInternal will throw an exception on a duplicate write, so we can safely write to disk
    lazyBytes.writeToDisk()
    // and because we are doing duplicate checks, `ToBeFileLazyBytes` can allow its in-memory
    // data to be garbage collected, because it can safely read from disk in the future
  }
}

class ToBeFileLazyBytes(val location: TypedPath, val layout: SnapshotFileLayout, data: ByteArray) {
  /** When constructed, we always have the data. */
  var data: ByteArray? = data
  /**
   * Shortly after being construted, this data is written to disk, and we can stop holding it in
   * memory.
   */
  internal fun writeToDisk() {
    data?.let { layout.fs.fileWriteBinary(location, it) }
        ?: throw IllegalStateException("Data has already been written to disk!")
    data = null
  }
  /**
   * If we need to read our data, we do it from memory if it's still there, or from disk if it
   * isn't.
   */
  private fun readData(): ByteArray = data ?: layout.fs.fileReadBinary(location)
  /** We calculate equality based on this data. */
  override fun equals(other: Any?): Boolean =
      if (this === other) true
      else if (other is ToBeFileLazyBytes) readData().contentEquals(other.readData()) else false
  override fun hashCode(): Int = readData().contentHashCode()
}

class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue<*>>() {
  fun record(call: CallStack, literalValue: LiteralValue<*>, layout: SnapshotFileLayout) {
    recordInternal(call.location, literalValue, call, layout)
    // assert that the value passed at runtime matches the value we parse at compile time
    // because if that assert fails, we've got no business modifying test code
    val file = layout.sourcePathForCall(call.location)
    if (literalValue.expected != null) {
      // if expected == null, it's a `toBe_TODO()`, so there's nothing to check
      val content = SourceFile(file.name, layout.fs.fileRead(file))
      val parsedValue =
          try {
            content.parseToBeLike(call.location.line).parseLiteral(literalValue.format)
          } catch (e: Exception) {
            throw AssertionError(
                "Error while parsing the literal at ${call.location.ideLink(layout)}. Please report this error at https://github.com/diffplug/selfie",
                e)
          }
      if (parsedValue != literalValue.expected) {
        throw layout.fs.assertFailed(
            "Selfie cannot modify the literal at ${call.location.ideLink(layout)} because Selfie has a parsing bug. Please report this error at https://github.com/diffplug/selfie",
            literalValue.expected,
            parsedValue)
      }
    }
  }
  fun hasWrites(): Boolean = writes.get().isNotEmpty()

  private class FileLineLiteral(val file: TypedPath, val line: Int, val literal: LiteralValue<*>) :
      Comparable<FileLineLiteral> {
    override fun compareTo(other: FileLineLiteral): Int =
        compareValuesBy(this, other, { it.file }, { it.line })
  }
  fun persistWrites(layout: SnapshotFileLayout) {
    // global sort by filename and line, previously might have been polluted by multiple classes
    // within a single file
    val writes =
        writes
            .get()
            .toList()
            .map {
              FileLineLiteral(
                  layout.sourcePathForCall(it.first)!!, it.first.line, it.second.snapshot)
            }
            .sorted()
    if (writes.isEmpty()) {
      return
    }

    var file = writes.first().file
    var content = SourceFile(file.name, layout.fs.fileRead(file))
    var deltaLineNumbers = 0
    for (write in writes) {
      if (write.file != file) {
        layout.fs.fileWrite(file, content.asString)
        file = write.file
        deltaLineNumbers = 0
        content = SourceFile(file.name, layout.fs.fileRead(file))
      }
      // parse the location within the file
      val line = write.line + deltaLineNumbers
      if (write.literal.format == LiteralTodoStub) {
        val kind = write.literal.actual as TodoStub
        content.replaceOnLine(line, ".${kind.name}_TODO(", ".${kind.name}(")
      } else {
        deltaLineNumbers += content.parseToBeLike(line).setLiteralAndGetNewlineDelta(write.literal)
      }
    }
    layout.fs.fileWrite(file, content.asString)
  }
}

internal enum class EscapeLeadingWhitespace {
  ALWAYS,
  NEVER,
  ONLY_ON_SPACE,
  ONLY_ON_TAB;
  fun escapeLine(line: String, space: String, tab: String): String =
      if (line.startsWith(" ")) {
        if (this == ALWAYS || this == ONLY_ON_SPACE) "$space${line.drop(1)}" else line
      } else if (line.startsWith("\t")) {
        if (this == ALWAYS || this == ONLY_ON_TAB) "$tab${line.drop(1)}" else line
      } else line

  companion object {
    private val MIXED = 'm'
    fun appropriateFor(fileContent: String): EscapeLeadingWhitespace {
      val commonWhitespace =
          fileContent
              .lineSequence()
              .mapNotNull { line ->
                val whitespace = line.takeWhile { it.isWhitespace() }
                if (whitespace.isEmpty()) null
                else if (whitespace.all { it == ' ' }) ' '
                else if (whitespace.all { it == '\t' }) '\t' else MIXED
              }
              .reduceOrNull { a, b -> if (a == b) a else MIXED }
      return if (commonWhitespace == ' ') ONLY_ON_TAB
      else if (commonWhitespace == '\t') ONLY_ON_SPACE else ALWAYS
    }
  }
}
fun <T> atomic(initial: T): AtomicRef<T> = AtomicRef(initial)

class AtomicRef<T>(value: T) {
  val ref = AtomicReference(value)
  fun get() = ref.get()
  fun updateAndGet(update: (T) -> T): T = ref.updateAndGet(update)
  fun getAndUpdate(update: (T) -> T) = ref.getAndUpdate(update)
}
fun reentrantLock() = com.diffplug.selfie.guts.ReentrantLock()

typealias ReentrantLock = java.util.concurrent.locks.ReentrantLock
inline fun <T> ReentrantLock.withLock(block: () -> T): T {
  lock()
  try {
    return block()
  } finally {
    unlock()
  }
}

/**
 * Tracks whether a given file has a comment which allows it to be written to. Thread-safe on
 * multithreaded platforms.
 */
class CommentTracker {
  private enum class WritableComment {
    NO_COMMENT,
    ONCE,
    FOREVER;
    val writable: Boolean
      get() = this != NO_COMMENT
  }
  private val cache = atomic(ArrayMap.empty<TypedPath, WritableComment>())
  fun pathsWithOnce(): Iterable<TypedPath> =
      cache.get().mapNotNull { if (it.value == WritableComment.ONCE) it.key else null }
  fun hasWritableComment(call: CallStack, layout: SnapshotFileLayout): Boolean {
    val path = layout.sourcePathForCall(call.location)
    val comment = cache.get()[path]
    return if (comment != null) {
      comment.writable
    } else {
      val newComment = commentAndLine(path, layout.fs).first
      cache.updateAndGet { it.plus(path, newComment) }
      newComment.writable
    }
  }

  companion object {
    fun commentString(typedPath: TypedPath, fs: FS): Pair<String, Int> {
      val (comment, line) = commentAndLine(typedPath, fs)
      return when (comment) {
        WritableComment.NO_COMMENT -> throw UnsupportedOperationException()
        WritableComment.ONCE -> Pair("//selfieonce", line)
        WritableComment.FOREVER -> Pair("//SELFIEWRITE", line)
      }
    }
    private fun commentAndLine(typedPath: TypedPath, fs: FS): Pair<WritableComment, Int> {
      // TODO: there is a bug here due to string constants, and non-C file comments
      val content = Slice(fs.fileRead(typedPath))
      for (comment in listOf("//selfieonce", "// selfieonce", "//SELFIEWRITE", "// SELFIEWRITE")) {
        val index = content.indexOf(comment)
        if (index != -1) {
          val lineNumber = content.baseLineAtOffset(index)
          val comment =
              if (comment.contains("once")) WritableComment.ONCE else WritableComment.FOREVER
          return Pair(comment, lineNumber)
        }
      }
      return Pair(WritableComment.NO_COMMENT, -1)
    }
  }
}

internal abstract class ArrayBackedLRUCache<K : Any, V>(private val capacity: Int) {
  private val cache: Array<Pair<K, V>?> = arrayOfNulls<Pair<K, V>?>(capacity)
  abstract fun keyEquality(a: K, b: K): Boolean
  private fun indexOf(key: K): Int {
    for (i in cache.indices) {
      if (cache[i]?.first?.let { keyEquality(it, key) } == true) {
        return i
      }
    }
    return -1
  }
  fun put(key: K, value: V) {
    val foundIndex = indexOf(key)
    if (foundIndex != -1) {
      // key exists, update value and move to most recently used position
      moveToFront(foundIndex)
    } else {
      // move the last element to the front and overwrite it
      moveToFront(capacity - 1)
    }
    cache[0] = Pair(key, value)
  }
  fun get(key: K): V? {
    val foundIndex = indexOf(key)
    return if (foundIndex == -1) null
    else {
      moveToFront(foundIndex)
      cache[0]!!.second
    }
  }
  private fun moveToFront(index: Int) {
    if (index == 0) {
      return
    }
    val newFront = cache[index]
    for (i in index downTo 1) {
      cache[i] = cache[i - 1]
    }
    cache[0] = newFront
  }
  override fun toString() = cache.mapNotNull { it }.joinToString(" ") { (k, v) -> "$k=$v" }
}

class SourcePathCache(private val functionToCache: (CallLocation) -> TypedPath?, capacity: Int) {
  private val lock = reentrantLock()
  private val backingCache =
      object : ArrayBackedLRUCache<CallLocation, TypedPath>(capacity) {
        override fun keyEquality(a: CallLocation, b: CallLocation) = a.samePathAs(b)
      }
  fun get(key: CallLocation): TypedPath? {
    lock.withLock {
      backingCache.get(key)?.let {
        return it
      }
      val path = functionToCache(key)
      return if (path == null) null
      else {
        backingCache.put(key, path)
        path
      }
    }
  }
}
internal fun jreVersion(): Int {
  val versionStr = System.getProperty("java.version")
  return if (versionStr.startsWith("1.")) {
    if (versionStr.startsWith("1.8")) 8 else throw Error("Unsupported java version: $versionStr")
  } else {
    versionStr.substringBefore('.').toInt()
  }
}

enum class Language {
  JAVA,
  JAVA_PRE15,
  KOTLIN,
  GROOVY,
  SCALA;

  companion object {
    fun fromFilename(filename: String): Language {
      return when (filename.substringAfterLast('.')) {
        "java" -> if (jreVersion() < 15) JAVA_PRE15 else JAVA
        "kt" -> KOTLIN
        "groovy",
        "gvy",
        "gy" -> GROOVY
        "scala",
        "sc" -> SCALA
        else -> throw IllegalArgumentException("Unknown language for file $filename")
      }
    }
  }
}

class LiteralValue<T : Any>(val expected: T?, val actual: T, val format: LiteralFormat<T>)

abstract class LiteralFormat<T : Any> {
  internal abstract fun encode(
      value: T,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ): String
  internal abstract fun parse(str: String, language: Language): T
}

private const val MAX_RAW_NUMBER = 1000
private const val PADDING_SIZE = MAX_RAW_NUMBER.toString().length - 1
private fun encodeUnderscores(
    buffer: StringBuilder,
    value: Long,
    language: Language
): StringBuilder {
  return if (value >= MAX_RAW_NUMBER) {
    val mod = value % MAX_RAW_NUMBER
    val leftPadding = PADDING_SIZE - mod.toString().length
    encodeUnderscores(buffer, value / MAX_RAW_NUMBER, language)
    buffer.append("_")
    for (i in leftPadding downTo 1) {
      buffer.append('0')
    }
    buffer.append(mod)
    buffer
  } else if (value < 0) {
    buffer.append('-')
    encodeUnderscores(buffer, abs(value), language)
  } else {
    buffer.append(value)
  }
}

internal object LiteralInt : LiteralFormat<Int>() {
  override fun encode(
      value: Int,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ): String {
    return encodeUnderscores(StringBuilder(), value.toLong(), language).toString()
  }
  override fun parse(str: String, language: Language): Int {
    return str.replace("_", "").toInt()
  }
}

internal object LiteralLong : LiteralFormat<Long>() {
  override fun encode(
      value: Long,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ): String {
    val buffer = encodeUnderscores(StringBuilder(), value, language)
    buffer.append('L')
    return buffer.toString()
  }
  override fun parse(str: String, language: Language): Long {
    var longStr = str.replace("_", "")
    if (longStr.endsWith("L")) {
      longStr = longStr.substring(0, longStr.length - 1)
    }
    return longStr.toLong()
  }
}

internal object LiteralString : LiteralFormat<String>() {
  override fun encode(
      value: String,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ): String =
      if (value.indexOf('\n') == -1)
          when (language) {
            Language.SCALA, // scala only does $ substitution for s" and f" strings
            Language.JAVA_PRE15,
            Language.GROOVY,
            Language.JAVA -> encodeSingleJava(value)
            Language.KOTLIN -> encodeSingleJavaWithDollars(value)
          }
      else
          when (language) {
            // TODO: support triple-quoted strings in scala
            // https://github.com/diffplug/selfie/issues/106
            Language.SCALA,
            // TODO: support triple-quoted strings in groovy
            // https://github.com/diffplug/selfie/issues/105
            Language.GROOVY,
            Language.JAVA_PRE15 -> encodeSingleJava(value)
            Language.JAVA -> encodeMultiJava(value, encodingPolicy)
            Language.KOTLIN -> encodeMultiKotlin(value, encodingPolicy)
          }
  override fun parse(str: String, language: Language): String =
      if (!str.startsWith(TRIPLE_QUOTE))
          when (language) {
            Language.SCALA,
            Language.JAVA_PRE15,
            Language.JAVA -> parseSingleJava(str)
            Language.GROOVY,
            Language.KOTLIN -> parseSingleJavaWithDollars(str)
          }
      else
          when (language) {
            Language.SCALA ->
                throw UnsupportedOperationException(
                    "Selfie doesn't support triple-quoted strings in Scala, yet - help wanted: https://github.com/diffplug/selfie/issues/106")
            Language.GROOVY ->
                throw UnsupportedOperationException(
                    "Selfie doesn't support triple-quoted strings in Groovy, yet - help wanted: https://github.com/diffplug/selfie/issues/105")
            Language.JAVA_PRE15,
            Language.JAVA -> parseMultiJava(str)
            Language.KOTLIN -> parseMultiKotlin(str)
          }
  fun encodeSingleJava(value: String): String = encodeSingleJavaish(value, false)
  fun encodeSingleJavaWithDollars(value: String) = encodeSingleJavaish(value, true)
  private fun encodeSingleJavaish(value: String, escapeDollars: Boolean): String {
    val source = StringBuilder()
    source.append("\"")
    for (char in value) {
      when (char) {
        '\b' -> source.append("\\b")
        '\n' -> source.append("\\n")
        '\r' -> source.append("\\r")
        '\t' -> source.append("\\t")
        '\"' -> source.append("\\\"")
        '\\' -> source.append("\\\\")
        '$' -> if (escapeDollars) source.append(KOTLIN_DOLLAR) else source.append('$')
        else ->
            if (isControlChar(char)) {
              source.append("\\u")
              source.append(char.code.toString(16).padStart(4, '0'))
            } else {
              source.append(char)
            }
      }
    }
    source.append("\"")
    return source.toString()
  }
  private fun isControlChar(c: Char): Boolean {
    return c in '\u0000'..'\u001F' || c == '\u007F'
  }
  fun parseSingleJava(sourceWithQuotes: String) = parseSingleJavaish(sourceWithQuotes, false)
  fun parseSingleJavaWithDollars(sourceWithQuotes: String) =
      parseSingleJavaish(sourceWithQuotes, true)
  private fun parseSingleJavaish(sourceWithQuotes: String, removeDollars: Boolean): String {
    check(sourceWithQuotes.startsWith('"'))
    check(sourceWithQuotes.endsWith('"'))
    val source = sourceWithQuotes.substring(1, sourceWithQuotes.length - 1)
    val toUnescape = if (removeDollars) inlineDollars(source) else source
    return unescapeJava(toUnescape)
  }
  fun encodeMultiKotlin(arg: String, escapeLeadingWhitespace: EscapeLeadingWhitespace): String {
    val escapeDollars = arg.replace("$", KOTLIN_DOLLAR)
    val escapeTripleQuotes =
        escapeDollars.replace(
            TRIPLE_QUOTE, "$KOTLIN_DOLLARQUOTE$KOTLIN_DOLLARQUOTE$KOTLIN_DOLLARQUOTE")
    val protectWhitespace =
        escapeTripleQuotes.lines().joinToString("\n") { line ->
          val protectTrailingWhitespace =
              if (line.endsWith(" ")) {
                line.dropLast(1) + "\${' '}"
              } else if (line.endsWith("\t")) {
                line.dropLast(1) + "\${'\\t'}"
              } else line
          escapeLeadingWhitespace.escapeLine(protectTrailingWhitespace, "\${' '}", "\${'\\t'}")
        }
    return "$TRIPLE_QUOTE$protectWhitespace$TRIPLE_QUOTE"
  }
  fun encodeMultiJava(arg: String, escapeLeadingWhitespace: EscapeLeadingWhitespace): String {
    val escapeBackslashes = arg.replace("\\", "\\\\")
    val escapeTripleQuotes = escapeBackslashes.replace(TRIPLE_QUOTE, "\\\"\\\"\\\"")
    var protectWhitespace =
        escapeTripleQuotes.lines().joinToString("\n") { line ->
          val protectTrailingWhitespace =
              if (line.endsWith(" ")) {
                line.dropLast(1) + "\\s"
              } else if (line.endsWith("\t")) {
                line.dropLast(1) + "\\t"
              } else line
          escapeLeadingWhitespace.escapeLine(protectTrailingWhitespace, "\\s", "\\t")
        }
    val commonPrefix =
        protectWhitespace
            .lines()
            .mapNotNull { line ->
              if (line.isNotBlank()) line.takeWhile { it.isWhitespace() } else null
            }
            .minOrNull() ?: ""
    if (commonPrefix.isNotEmpty()) {
      val lines = protectWhitespace.lines()
      val last = lines.last()
      protectWhitespace =
          lines.joinToString("\n") { line ->
            if (line === last) {
              if (line.startsWith(" ")) "\\s${line.drop(1)}"
              else if (line.startsWith("\t")) "\\t${line.drop(1)}"
              else
                  throw UnsupportedOperationException(
                      "How did it end up with a common whitespace prefix?")
            } else line
          }
    }
    return "$TRIPLE_QUOTE\n$protectWhitespace$TRIPLE_QUOTE"
  }
  private val charLiteralRegex = """\$\{'(\\?.)'\}""".toRegex()
  private fun inlineDollars(source: String): String {
    if (source.indexOf('$') == -1) {
      return source
    }
    return charLiteralRegex.replace(source) { matchResult ->
      val charLiteral = matchResult.groupValues[1]
      when {
        charLiteral.length == 1 -> charLiteral
        charLiteral.length == 2 && charLiteral[0] == '\\' ->
            when (charLiteral[1]) {
              't' -> "\t"
              'b' -> "\b"
              'n' -> "\n"
              'r' -> "\r"
              '\'' -> "'"
              '\\' -> "\\"
              '$' -> "$"
              else -> charLiteral
            }
        else -> throw IllegalArgumentException("Unknown character literal $charLiteral")
      }
    }
  }
  private fun unescapeJava(source: String): String {
    val firstEscape = source.indexOf('\\')
    if (firstEscape == -1) {
      return source
    }
    val value = StringBuilder()
    value.append(source.substring(0, firstEscape))
    var i = firstEscape
    while (i < source.length) {
      var c = source[i]
      if (c == '\\') {
        i++
        c = source[i]
        when (c) {
          '\"' -> value.append('\"')
          '\\' -> value.append('\\')
          'b' -> value.append('\b')
          'f' -> value.append('\u000c')
          'n' -> value.append('\n')
          'r' -> value.append('\r')
          's' -> value.append(' ')
          't' -> value.append('\t')
          'u' -> {
            val code = source.substring(i + 1, i + 5).toInt(16)
            value.append(code.toChar())
            i += 4
          }
          else -> throw IllegalArgumentException("Unknown escape sequence $c")
        }
      } else {
        value.append(c)
      }
      i++
    }
    return value.toString()
  }
  fun parseMultiJava(sourceWithQuotes: String): String {
    check(sourceWithQuotes.startsWith("$TRIPLE_QUOTE\n"))
    check(sourceWithQuotes.endsWith(TRIPLE_QUOTE))
    val source =
        sourceWithQuotes.substring(
            TRIPLE_QUOTE.length + 1, sourceWithQuotes.length - TRIPLE_QUOTE.length)
    val lines = source.lines()
    val commonPrefix =
        lines
            .mapNotNull { line ->
              if (line.isNotBlank()) line.takeWhile { it.isWhitespace() } else null
            }
            .minOrNull() ?: ""
    return lines.joinToString("\n") { line ->
      if (line.isBlank()) {
        ""
      } else {
        val removedPrefix = if (commonPrefix.isEmpty()) line else line.removePrefix(commonPrefix)
        val removeTrailingWhitespace = removedPrefix.trimEnd()
        val handleEscapeSequences = unescapeJava(removeTrailingWhitespace)
        handleEscapeSequences
      }
    }
  }
  fun parseMultiKotlin(sourceWithQuotes: String): String {
    check(sourceWithQuotes.startsWith(TRIPLE_QUOTE))
    check(sourceWithQuotes.endsWith(TRIPLE_QUOTE))
    val source =
        sourceWithQuotes.substring(
            TRIPLE_QUOTE.length, sourceWithQuotes.length - TRIPLE_QUOTE.length)
    return inlineDollars(source)
  }
}

internal object LiteralBoolean : LiteralFormat<Boolean>() {
  override fun encode(
      value: Boolean,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ): String {
    return value.toString()
  }
  override fun parse(str: String, language: Language): Boolean {
    return str.toBooleanStrict()
  }
}

/** Some kinds of _TODO don't change the argument at all. */
enum class TodoStub {
  toMatchDisk,
  toBeFile;
  fun createLiteral() = LiteralValue(null, this, LiteralTodoStub)
}

internal object LiteralTodoStub : LiteralFormat<TodoStub>() {
  override fun encode(
      value: TodoStub,
      language: Language,
      encodingPolicy: EscapeLeadingWhitespace
  ) = throw UnsupportedOperationException()
  override fun parse(str: String, language: Language) = throw UnsupportedOperationException()
  fun createLiteral(kind: TodoStub) = LiteralValue(null, kind, LiteralTodoStub)
}

internal class Slice(val base: String, val startIndex: Int = 0, val endIndex: Int = base.length) :
    CharSequence {
  init {
    require(0 <= startIndex)
    require(startIndex <= endIndex)
    require(endIndex <= base.length)
  }
  override val length: Int
    get() = endIndex - startIndex
  override fun get(index: Int): Char = base[startIndex + index]
  override fun subSequence(start: Int, end: Int): Slice =
      Slice(base, startIndex + start, startIndex + end)

  /** Same behavior as [String.trim]. */
  fun trim(): Slice {
    var end = length
    var start = 0
    while (start < end && get(start).isWhitespace()) {
      ++start
    }
    while (start < end && get(end - 1).isWhitespace()) {
      --end
    }
    return if (start > 0 || end < length) subSequence(start, end) else this
  }
  override fun toString() = base.subSequence(startIndex, endIndex).toString()
  fun sameAs(other: CharSequence): Boolean {
    if (length != other.length) {
      return false
    }
    for (i in 0 until length) {
      if (get(i) != other[i]) {
        return false
      }
    }
    return true
  }
  fun indexOf(lookingFor: String, startOffset: Int = 0): Int {
    val result = base.indexOf(lookingFor, startIndex + startOffset)
    return if (result == -1 || result >= endIndex) -1 else result - startIndex
  }
  fun indexOf(lookingFor: Char, startOffset: Int = 0): Int {
    val result = base.indexOf(lookingFor, startIndex + startOffset)
    return if (result == -1 || result >= endIndex) -1 else result - startIndex
  }
  /** Returns a slice at the nth line. Handy for expanding the slice from there. */
  fun unixLine(count: Int): Slice {
    check(count > 0)
    var lineStart = 0
    for (i in 1 until count) {
      lineStart = indexOf('\n', lineStart)
      require(lineStart >= 0) { "This string has only ${i - 1} lines, not $count" }
      ++lineStart
    }
    val lineEnd = indexOf('\n', lineStart)
    return if (lineEnd == -1) {
      Slice(base, startIndex + lineStart, endIndex)
    } else {
      Slice(base, startIndex + lineStart, startIndex + lineEnd)
    }
  }
  override fun equals(other: Any?) =
      if (this === other) {
        true
      } else if (other is Slice) {
        sameAs(other)
      } else {
        false
      }
  override fun hashCode(): Int {
    var h = 0
    for (i in indices) {
      h = 31 * h + get(i).code
    }
    return h
  }
  /** Returns the underlying string with this slice replaced by the given string. */
  fun replaceSelfWith(s: String): String {
    val deltaLength = s.length - length
    val builder = StringBuilder(base.length + deltaLength)
    builder.appendRange(base, 0, startIndex)
    builder.append(s)
    builder.appendRange(base, endIndex, base.length)
    return builder.toString()
  }
  fun baseLineAtOffset(index: Int) = 1 + Slice(base, 0, index).count { it == '\n' }
}

/** Used by [com.diffplug.selfie.SelfieSuspend]. */
class CoroutineDiskStorage(val disk: DiskStorage) : AbstractCoroutineContextElement(Key) {
  override val key = Key

  companion object Key : CoroutineContext.Key<CoroutineDiskStorage>
}

/** A unix-style path where trailing-slash means it is a folder. */
data class TypedPath(val absolutePath: String) : Comparable<TypedPath> {
  override fun compareTo(other: TypedPath): Int = absolutePath.compareTo(other.absolutePath)
  val name: String
    get() {
      val lastSlash = absolutePath.lastIndexOf('/')
      return if (lastSlash == -1) absolutePath else absolutePath.substring(lastSlash + 1)
    }
  val isFolder: Boolean
    get() = absolutePath.endsWith("/")
  private fun assertFolder() {
    check(isFolder) { "Expected $this to be a folder but it doesn't end with `/`" }
  }
  fun parentFolder(): TypedPath {
    val lastIdx = absolutePath.lastIndexOf('/')
    check(lastIdx != -1)
    return ofFolder(absolutePath.substring(0, lastIdx + 1))
  }
  fun resolveFile(child: String): TypedPath {
    assertFolder()
    check(!child.startsWith("/")) { "Expected child to not start with a slash, but got $child" }
    check(!child.endsWith("/")) { "Expected child to not end with a slash, but got $child" }
    return ofFile("$absolutePath$child")
  }
  fun resolveFolder(child: String): TypedPath {
    assertFolder()
    check(!child.startsWith("/")) { "Expected child to not start with a slash, but got $child" }
    return ofFolder("$absolutePath$child")
  }
  fun relativize(child: TypedPath): String {
    assertFolder()
    check(child.absolutePath.startsWith(absolutePath)) {
      "Expected $child to start with $absolutePath"
    }
    return child.absolutePath.substring(absolutePath.length)
  }

  companion object {
    /** A folder at the given path. */
    fun ofFolder(path: String): TypedPath {
      val unixPath = path.replace("\\", "/")
      return TypedPath(if (unixPath.endsWith("/")) unixPath else "$unixPath/")
    }
    /** A file (NOT a folder) at the given path. */
    fun ofFile(path: String): TypedPath {
      val unixPath = path.replace("\\", "/")
      check(!unixPath.endsWith("/")) { "Expected path to not end with a slash, but got $unixPath" }
      return TypedPath(unixPath)
    }
  }
}

interface FS {
  /**
   * Returns true if the given path exists *and is a file*, false if it doesn't or if it is a
   * folder.
   */
  fun fileExists(typedPath: TypedPath): Boolean
  /** Walks the files (not directories) which are children and grandchildren of the given path. */
  fun <T> fileWalk(typedPath: TypedPath, walk: (Sequence<TypedPath>) -> T): T
  fun fileRead(typedPath: TypedPath) = fileReadBinary(typedPath).decodeToString()
  fun fileWrite(typedPath: TypedPath, content: String) =
      fileWriteBinary(typedPath, content.encodeToByteArray())
  fun fileReadBinary(typedPath: TypedPath): ByteArray
  fun fileWriteBinary(typedPath: TypedPath, content: ByteArray)
  /** Creates an assertion failed exception to throw. */
  fun assertFailed(message: String, expected: Any? = null, actual: Any? = null): Throwable
}

/** NOT FOR ENDUSERS. Implemented by Selfie to integrate with various test frameworks. */
interface SnapshotSystem {
  val fs: FS
  val mode: Mode
  val layout: SnapshotFileLayout
  /** Returns true if the sourcecode for the given call has a writable annotation. */
  fun sourceFileHasWritableComment(call: CallStack): Boolean
  /** Indicates that the following value should be written into test sourcecode. */
  fun writeInline(literalValue: LiteralValue<*>, call: CallStack)
  /** Writes the given bytes to the given file, checking for duplicate writes. */
  fun writeToBeFile(path: TypedPath, data: ByteArray, call: CallStack)
  /** Returns the DiskStorage for the test associated with this thread, else error. */
  fun diskThreadLocal(): DiskStorage
}

/** Represents the disk storage for a specific test. */
interface DiskStorage {
  /** Reads the given snapshot from disk. */
  fun readDisk(sub: String, call: CallStack): Snapshot?
  /** Writes the given snapshot to disk. */
  fun writeDisk(actual: Snapshot, sub: String, call: CallStack)
  /**
   * Marks that the following sub snapshots should be kept, null means to keep all snapshots for the
   * currently executing class.
   */
  fun keep(subOrKeepAll: String?)
}
fun initSnapshotSystem(): SnapshotSystem {
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

interface SnapshotFileLayout {
  val rootFolder: TypedPath
  val fs: FS
  val allowMultipleEquivalentWritesToOneLocation: Boolean
  fun sourcePathForCall(call: CallLocation): TypedPath
  fun sourcePathForCallMaybe(call: CallLocation): TypedPath?
  fun checkForSmuggledError()
}

/**
 * @param filename The filename (not full path, but the extension is used for language-specific
 *   parsing).
 * @param content The exact content of the file, unix or windows newlines will be preserved
 */
class SourceFile(filename: String, content: String) {
  private val unixNewlines = content.indexOf('\r') == -1
  private var contentSlice = Slice(content.efficientReplace("\r\n", "\n"))
  private val language = Language.fromFilename(filename)
  private val escapeLeadingWhitespace =
      EscapeLeadingWhitespace.appropriateFor(contentSlice.toString())

  /**
   * Returns the content of the file, possibly modified by
   * [ToBeLiteral.setLiteralAndGetNewlineDelta].
   */
  val asString: String
    get() = contentSlice.toString().let { if (unixNewlines) it else it.replace("\n", "\r\n") }

  /**
   * Represents a section of the sourcecode which is a `.toBe(LITERAL)` call. It might also be
   * `.toBe_TODO()` or ` toBe LITERAL` (infix notation).
   */
  inner class ToBeLiteral
  internal constructor(
      internal val dotFunOpenParen: String,
      internal val functionCallPlusArg: Slice,
      internal val arg: Slice,
  ) {
    /**
     * Modifies the parent [SourceFile] to set the value within the `toBe` call, and returns the net
     * change in newline count.
     */
    fun <T : Any> setLiteralAndGetNewlineDelta(literalValue: LiteralValue<T>): Int {
      val encoded =
          literalValue.format.encode(literalValue.actual, language, escapeLeadingWhitespace)
      val roundTripped = literalValue.format.parse(encoded, language) // sanity check
      if (roundTripped != literalValue.actual) {
        throw Error(
            "There is an error in " +
                literalValue.format::class.simpleName +
                ", the following value isn't round tripping.\n" +
                "Please this error and the data below at https://github.com/diffplug/selfie/issues/new\n" +
                "```\n" +
                "ORIGINAL\n" +
                literalValue.actual +
                "\n" +
                "ROUNDTRIPPED\n" +
                roundTripped +
                "\n" +
                "ENCODED ORIGINAL\n" +
                encoded +
                "\n" +
                "```\n")
      }
      val existingNewlines = functionCallPlusArg.count { it == '\n' }
      val newNewlines = encoded.count { it == '\n' }
      contentSlice = Slice(functionCallPlusArg.replaceSelfWith("${dotFunOpenParen}${encoded})"))
      return newNewlines - existingNewlines
    }

    /**
     * Parses the current value of the value within `.toBe()`. This method should not be called on
     * `toBe_TODO()`.
     */
    fun <T : Any> parseLiteral(literalFormat: LiteralFormat<T>): T {
      return literalFormat.parse(arg.toString(), language)
    }
  }
  fun removeSelfieOnceComments() {
    // TODO: there is a bug here due to string constants, and non-C file comments
    contentSlice =
        Slice(contentSlice.toString().replace("//selfieonce", "").replace("// selfieonce", ""))
  }
  private fun findOnLine(toFind: String, lineOneIndexed: Int): Slice {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val idx = lineContent.indexOf(toFind)
    if (idx == -1) {
      throw AssertionError(
          "Expected to find `$toFind` on line $lineOneIndexed, but there was only `${lineContent}`")
    }
    return lineContent.subSequence(idx, idx + toFind.length)
  }
  fun replaceOnLine(lineOneIndexed: Int, find: String, replace: String) {
    check(find.indexOf('\n') == -1)
    check(replace.indexOf('\n') == -1)
    val slice = findOnLine(find, lineOneIndexed)
    contentSlice = Slice(slice.replaceSelfWith(replace))
  }
  fun parseToBeLike(lineOneIndexed: Int): ToBeLiteral {
    val lineContent = contentSlice.unixLine(lineOneIndexed)
    val dotFunOpenParen =
        TO_BE_LIKES.mapNotNull {
              val idx = lineContent.indexOf(it)
              if (idx == -1) null else idx to it
            }
            .minByOrNull { it.first }
            ?.second
            ?: throw AssertionError(
                "Expected to find inline assertion on line $lineOneIndexed, but there was only `${lineContent}`")
    val dotFunctionCallInPlace = lineContent.indexOf(dotFunOpenParen)
    val dotFunctionCall = dotFunctionCallInPlace + lineContent.startIndex
    var argStart = dotFunctionCall + dotFunOpenParen.length
    if (contentSlice.length == argStart) {
      throw AssertionError(
          "Appears to be an unclosed function call `$dotFunOpenParen)` on line $lineOneIndexed")
    }
    while (contentSlice[argStart].isWhitespace()) {
      ++argStart
      if (contentSlice.length == argStart) {
        throw AssertionError(
            "Appears to be an unclosed function call `$dotFunOpenParen)` on line $lineOneIndexed")
      }
    }

    // argStart is now the first non-whitespace character after the opening paren
    var endArg = -1
    var endParen: Int
    if (contentSlice[argStart] == '"') {
      if (contentSlice.subSequence(argStart, contentSlice.length).startsWith(TRIPLE_QUOTE)) {
        endArg = contentSlice.indexOf(TRIPLE_QUOTE, argStart + TRIPLE_QUOTE.length)
        if (endArg == -1) {
          throw AssertionError(
              "Appears to be an unclosed multiline string literal `${TRIPLE_QUOTE}` on line $lineOneIndexed")
        } else {
          endArg += TRIPLE_QUOTE.length
          endParen = endArg
        }
      } else {
        endArg = argStart + 1
        while (contentSlice[endArg] != '"' || contentSlice[endArg - 1] == '\\') {
          ++endArg
          if (endArg == contentSlice.length) {
            throw AssertionError(
                "Appears to be an unclosed string literal `\"` on line $lineOneIndexed")
          }
        }
        endArg += 1
        endParen = endArg
      }
    } else {
      endArg = argStart
      while (!contentSlice[endArg].isWhitespace()) {
        if (contentSlice[endArg] == ')') {
          break
        }
        ++endArg
        if (endArg == contentSlice.length) {
          throw AssertionError("Appears to be an unclosed numeric literal on line $lineOneIndexed")
        }
      }
      endParen = endArg
    }
    while (contentSlice[endParen] != ')') {
      if (!contentSlice[endParen].isWhitespace()) {
        throw AssertionError(
            "Non-primitive literal in `$dotFunOpenParen)` starting at line $lineOneIndexed: error for character `${contentSlice[endParen]}` on line ${contentSlice.baseLineAtOffset(endParen)}")
      }
      ++endParen
      if (endParen == contentSlice.length) {
        throw AssertionError(
            "Appears to be an unclosed function call `$dotFunOpenParen)` starting at line $lineOneIndexed")
      }
    }
    return ToBeLiteral(
        dotFunOpenParen.replace("_TODO", ""),
        contentSlice.subSequence(dotFunctionCall, endParen + 1),
        contentSlice.subSequence(argStart, endArg))
  }
}
private val TO_BE_LIKES = listOf(".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO(")
/** Handles garbage collection of snapshots within a single test. */
class WithinTestGC {
  private val suffixesToKeep: AtomicRef<ArraySet<String>?> = atomic(ArraySet.empty())
  fun keepSuffix(suffix: String) {
    suffixesToKeep.updateAndGet { it?.plusOrThis(suffix) }
  }
  fun keepAll(): WithinTestGC {
    suffixesToKeep.updateAndGet { null }
    return this
  }
  override fun toString() = suffixesToKeep.get()?.toString() ?: "(null)"
  fun succeededAndUsedNoSnapshots() = suffixesToKeep.get() === ArraySet.empty<String>()
  private fun keeps(s: String): Boolean = suffixesToKeep.get()?.contains(s) ?: true

  companion object {
    fun findStaleSnapshotsWithin(
        snapshots: ArrayMap<String, Snapshot>,
        testsThatRan: ArrayMap<String, WithinTestGC>,
        testsThatDidntRun: Sequence<String>
    ): List<Int> {
      val staleIndices = mutableListOf<Int>()

      // - Every snapshot is named `testMethod` or `testMethod/subpath`
      // - It is possible to have `testMethod/subpath` without `testMethod`
      // - If a snapshot does not have a corresponding testMethod, it is stale
      // - If a method ran successfully, then we should keep exclusively the snapshots in
      // MethodSnapshotUsage#suffixesToKeep
      // - Unless that method has `keepAll`, in which case the user asked to exclude that method
      // from pruning

      // combine what we know about methods that did run with what we know about the tests that
      // didn't
      var totalGc = testsThatRan
      for (method in testsThatDidntRun) {
        totalGc = totalGc.plus(method, WithinTestGC().keepAll())
      }
      val gcRoots = totalGc.entries
      val keys = snapshots.keys
      // we'll start with the lowest gc, and the lowest key
      var gcIdx = 0
      var keyIdx = 0
      while (keyIdx < keys.size && gcIdx < gcRoots.size) {
        val key = keys[keyIdx]
        val gc = gcRoots[gcIdx]
        if (key.startsWith(gc.key)) {
          if (key.length == gc.key.length) {
            // startWith + same length = exact match, no suffix
            if (!gc.value.keeps("")) {
              staleIndices.add(keyIdx)
            }
            ++keyIdx
            continue
          } else if (key.elementAt(gc.key.length) == '/') {
            // startWith + not same length = can safely query the `/`
            val suffix = key.substring(gc.key.length)
            if (!gc.value.keeps(suffix)) {
              staleIndices.add(keyIdx)
            }
            ++keyIdx
            continue
          } else {
            // key is longer than gc.key, but doesn't start with gc.key, so we must increment gc
            ++gcIdx
            continue
          }
        } else {
          // we don't start with the key, so we must increment
          if (gc.key < key) {
            ++gcIdx
          } else {
            // we never found a gc that started with this key, so it's stale
            staleIndices.add(keyIdx)
            ++keyIdx
          }
        }
      }
      while (keyIdx < keys.size) {
        staleIndices.add(keyIdx)
        ++keyIdx
      }
      return staleIndices
    }
  }
}
