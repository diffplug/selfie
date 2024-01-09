import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class JavaMultilineString {
    @Test
    public void newlines() {
        Assertions.assertEquals("", """
                """);
        Assertions.assertEquals("\n", """
                                
                """);
        Assertions.assertEquals("\n\n", """
                                
                                
                """);
        // this is illegal, there can be no text after the triple quotes
        // Assertions.assertEquals("", """a
        // """);
    }

    @Test
    public void indentation() {
        Assertions.assertEquals("a", """
                a""");
        Assertions.assertEquals("a\n", """
                a
                """);
        Assertions.assertEquals("a\n", """
              a
                """);
        Assertions.assertEquals("  a\n", """
                  a
                """);
    }
}