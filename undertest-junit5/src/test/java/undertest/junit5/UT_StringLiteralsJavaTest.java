package undertest.junit5;

import org.junit.jupiter.api.Test;
import static com.diffplug.selfie.Selfie.expectSelfie;

public class UT_StringLiteralsJavaTest {
    @Test
    public void empty() {
        expectSelfie("").toBe_TODO();
    }

    @Test
    public void tabs() {
        expectSelfie("\t\t\t").toBe_TODO();
    }

    @Test
    public void spaces() {
        expectSelfie("   ").toBe_TODO();
    }

    @Test
    public void newlines() {
        expectSelfie("\n").toBe_TODO();
        expectSelfie("\n\n").toBe_TODO();
        expectSelfie("\n\n\n").toBe_TODO();
    }

    @Test
    public void escapableCharacters() {
        expectSelfie(" ' \" $ ").toBe_TODO();
        expectSelfie(" ' \" $ \n \"\"\"\"\"\"\"\"\"\t").toBe_TODO();
    }

    @Test
    public void allOfIt() {
        expectSelfie("  a\n" +
                "a  \n" +
                "\t a \t\n").toBe_TODO();
    }
}
