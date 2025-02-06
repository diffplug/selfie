package undertest.junit4;

import org.junit.Assert;
import org.junit.Test;

import static com.diffplug.selfie.Selfie.expectSelfie;

class UT_TestMethodVisibilityParentClass {
    @Test
    public void isPackage() {
        expectSelfie("package").toMatchDisk();
    }

    @Test
    public void isProtected() {
        expectSelfie("protected").toMatchDisk();
    }

    @Test
    public void isPrivate() {
        Assert.fail("Test methods can't be private");
    }
}
