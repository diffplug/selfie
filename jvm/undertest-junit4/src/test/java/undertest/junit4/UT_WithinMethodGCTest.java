package undertest.junit4;

import org.junit.Test;
import static com.diffplug.selfie.Selfie.expectSelfie;

public class UT_WithinMethodGCTest {
    @Test
    public void selfie2() {
//  @Test protected void selfie() {
//    expectSelfie("root").toMatchDisk();
    expectSelfie("oak").toMatchDisk("leaf");
    }

    @Test
    public void secondMethod() {
        expectSelfie("abc123").toMatchDisk();
    }
}
