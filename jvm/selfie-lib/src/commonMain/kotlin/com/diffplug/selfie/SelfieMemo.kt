package com.diffplug.selfie

import com.diffplug.selfie.guts.DiskSnapshotTodo
import com.diffplug.selfie.guts.DiskStorage
import com.diffplug.selfie.guts.LiteralFormat
import com.diffplug.selfie.guts.LiteralString
import com.diffplug.selfie.guts.LiteralValue
import com.diffplug.selfie.guts.SnapshotSystem
import com.diffplug.selfie.guts.recordCall
import kotlin.jvm.JvmOverloads

class StringMemo(val disk: DiskStorage, val generator: () -> String) {
    @JvmOverloads
    fun toMatchDisk(sub: String = "") : String {
        val call = recordCall(false)
        if (Selfie.system.mode.canWrite(false, call, Selfie.system)) {
            val actual = generator()
            disk.writeDisk(Snapshot.of(actual), sub, call)
            return actual
        } else {
            val snapshot = disk.readDisk(sub, call)
                    ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
            if (snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
                throw Selfie.system.fs.assertFailed("Expected a string subject with no facets, got ${snapshot}")
            }
            return snapshot.subject.valueString()
        }
    }
    @JvmOverloads
    fun toMatchDisk_TODO(sub: String = "") : String {
        val call = recordCall(false)
        if (Selfie.system.mode.canWrite(true, call, Selfie.system)) {
            val actual = generator()
            disk.writeDisk(Snapshot.of(actual), sub, call)
            Selfie.system.writeInline(DiskSnapshotTodo.createLiteral(), call)
            return actual
        } else {
            throw Selfie.system.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
        }
    }
    @JvmOverloads
    fun toBe_TODO(unusedArg: Any? = null) : String {
        val call = recordCall(false)
        val writable = Selfie.system.mode.canWrite(true, call, Selfie.system)
        if (writable) {
            val actual = generator()
            Selfie.system.writeInline(LiteralValue(null, actual, LiteralString), call)
            return actual
        } else {
            throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
        }
    }
    fun toBe(expected: String) : String = expected
}
class StringMemoSuspend(val disk: DiskStorage, val generator: suspend () -> String) {
    suspend fun toMatchDisk(sub: String = "") : String {
        val call = recordCall(false)
        if (Selfie.system.mode.canWrite(false, call, Selfie.system)) {
            val actual = generator()
            disk.writeDisk(Snapshot.of(actual), sub, call)
            return actual
        } else {
            val snapshot = disk.readDisk(sub, call)
                    ?: throw Selfie.system.fs.assertFailed(Selfie.system.mode.msgSnapshotNotFound())
            if (snapshot.subject.isBinary || snapshot.facets.isNotEmpty()) {
                throw Selfie.system.fs.assertFailed("Expected a string subject with no facets, got ${snapshot}")
            }
            return snapshot.subject.valueString()
        }
    }
    suspend fun toMatchDisk_TODO(sub: String = "") : String {
        val call = recordCall(false)
        if (Selfie.system.mode.canWrite(true, call, Selfie.system)) {
            val actual = generator()
            disk.writeDisk(Snapshot.of(actual), sub, call)
            Selfie.system.writeInline(DiskSnapshotTodo.createLiteral(), call)
            return actual
        } else {
            throw Selfie.system.fs.assertFailed("Can't call `toMatchDisk_TODO` in ${Mode.readonly} mode!")
        }
    }
    suspend fun toBe_TODO(unusedArg: Any? = null) : String {
        val call = recordCall(false)
        val writable = Selfie.system.mode.canWrite(true, call, Selfie.system)
        if (writable) {
            val actual = generator()
            Selfie.system.writeInline(LiteralValue(null, actual, LiteralString), call)
            return actual
        } else {
            throw Selfie.system.fs.assertFailed("Can't call `toBe_TODO` in ${Mode.readonly} mode!")
        }
    }
    fun toBe(expected: String) : String = expected
}
