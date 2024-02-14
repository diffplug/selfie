package undertest.junit5

import com.diffplug.selfie.coroutines.memoize
import com.diffplug.selfie.coroutines.memoizeAsJson
import com.diffplug.selfie.coroutines.memoizeBinarySerializable
import io.kotest.core.spec.style.FunSpec

class UT_Memoize :
    FunSpec({
      test("java.io.Serializable") {
        memoizeBinarySerializable { Book("Harry Potter", "J.K. Rowling") }.toBeFile_TODO("Book.bin")
      }
      test("kotlinx.serialization.Serializable") {
        memoizeAsJson { Book("Cat in the Hat", "Dr. Seuss") }
            .toBe("""{
${' '} "title": "Cat in the Hat",
${' '} "author": "Dr. Seuss"
}""")
      }
      test("nanoTimeTest") {
// easy way to test if it's memoizing or running every time
        memoize { System.nanoTime().toString() }.toBe_TODO()
      }
    })
