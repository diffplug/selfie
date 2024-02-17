package undertest.junit5

import com.diffplug.selfie.coroutines.cacheSelfie
import com.diffplug.selfie.coroutines.cacheSelfieBinarySerializable
import com.diffplug.selfie.coroutines.cacheSelfieJson
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe

class UT_Memoize :
    FunSpec({
      test("java.io.Serializable") {
        cacheSelfieBinarySerializable { Book("Harry Potter", "J.K. Rowling") }
            .toBeFile_TODO("Book.bin")
            .run { title shouldBe "Harry Potter" }
        cacheSelfieBinarySerializable { Book("Moby Dick", "Herman Melville") }
            .toBeBase64_TODO()
            .run { title shouldBe "Moby Dick" }
      }
      test("kotlinx.serialization.Serializable") {
        cacheSelfieJson { Book("Cat in the Hat", "Dr. Seuss") }
            .toBe("""{
${' '} "title": "Cat in the Hat",
${' '} "author": "Dr. Seuss"
}""")
            .run { title shouldBe "Cat in the Hat" }
      }
      test("nanoTimeTest") {
// easy way to test if it's memoizing or running every time
        cacheSelfie { System.nanoTime().toString() }.toBe_TODO()
      }
    })
