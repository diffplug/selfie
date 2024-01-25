package undertest.junit5;

import static com.diffplug.selfie.Selfie.expectSelfie;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class UT_TestMethodVisibility {
    @Test
    void isPackage() {
        expectSelfie("package").toMatchDisk();
    }

    @Test
    protected void isProtected() {
        expectSelfie("protected").toMatchDisk();
    }

    @Test
    private void isPrivate() {
        Assertions.fail("Test methods can't be private");
    }
}
