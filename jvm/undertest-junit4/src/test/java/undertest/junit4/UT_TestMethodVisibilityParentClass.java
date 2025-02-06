package undertest.junit4;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import static com.diffplug.selfie.Selfie.expectSelfie;

class UT_TestMethodVisibilityParentClass {
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
