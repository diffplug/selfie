package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.Test

class UT_StringLiteralsKotlinTest {
  @Test fun empty() {
    expectSelfie("").toBe_TODO()
  }

  @Test fun tabs() {
    expectSelfie("\t\t\t").toBe_TODO()
  }

  @Test fun spaces() {
    expectSelfie("   ").toBe_TODO()
  }

  @Test fun newlines() {
    expectSelfie("\n").toBe_TODO()
    expectSelfie("\n\n").toBe_TODO()
    expectSelfie("\n\n\n").toBe_TODO()
  }

  @Test fun escapableCharacters() {
    expectSelfie(" ' \" $ ").toBe_TODO()
    expectSelfie(" ' \" $ \n \"\"\"\"\"\"\"\"\"\t").toBe_TODO()
  }

  @Test fun allOfIt() {
    expectSelfie("  a\n" + "a  \n" + "\t a \t\n").toBe_TODO()
  }
}
