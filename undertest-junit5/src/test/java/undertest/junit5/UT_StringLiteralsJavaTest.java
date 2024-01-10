package undertest.junit5;

import org.junit.jupiter.api.Test;
import static com.diffplug.selfie.Selfie.expectSelfie;

public class UT_StringLiteralsJavaTest {
    @Test
    public void empty() {
        expectSelfie("").toBe("");
    }

    @Test
    public void tabs() {
        expectSelfie("\t\t\t").toBe("\t\t\t");
    }

    @Test
    public void spaces() {
        expectSelfie("   ").toBe("   ");
    }

    @Test
    public void newlines() {
        expectSelfie("\n").toBe("""

""");
        expectSelfie("\n\n").toBe("""


""");
        expectSelfie("\n\n\n").toBe("""



""");
    }

    @Test
    public void escapableCharacters() {
        expectSelfie(" ' \" $ ").toBe(" ' \" $ ");
        expectSelfie(" ' \" $ \n \"\"\"\"\"\"\"\"\"\t").toBe("""
\s' " $\s
\s\"\"\"\"\"\"\"\"\"\t""");
    }

    @Test
    public void allOfIt() {
        expectSelfie("  a\n" +
                "a  \n" +
                "\t a \t\n").toBe("""
\s a
a \s
\t a \t
""");
    }
}
