package undertest.junit4;

import org.junit.jupiter.api.Test;
import static com.diffplug.selfie.Selfie.expectSelfie;

public class UT_WithinMethodGCTest {
    @Test void selfie2() {
//  @Test protected void selfie() {
//    expectSelfie("root").toMatchDisk();
    expectSelfie("oak").toMatchDisk("leaf");
    }
    @Test void secondMethod() {
    expectSelfie("abc123").toMatchDisk();
    }
}
