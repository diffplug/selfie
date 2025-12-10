package undertest.junit4;

import static com.diffplug.selfie.Selfie.expectSelfie;

import org.junit.Assert;
import org.junit.Test;

public class UT_TestMethodVisibility extends UT_TestMethodVisibilityParentClass {
    // get test methods from parent class
    @Test
    public void isPrivate() {
        Assert.fail("Test methods can't be private");
    }
}
