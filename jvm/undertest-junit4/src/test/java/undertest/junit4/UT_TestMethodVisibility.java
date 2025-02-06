package undertest.junit4;

import static com.diffplug.selfie.Selfie.expectSelfie;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class UT_TestMethodVisibility extends UT_TestMethodVisibilityParentClass {
    // get test methods from parent class
    @Test
    private void isPrivate() {
        Assertions.fail("Test methods can't be private");
    }
}
