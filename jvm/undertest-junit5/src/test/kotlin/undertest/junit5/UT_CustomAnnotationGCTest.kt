package undertest.junit5
// spotless:off
import com.diffplug.selfie.Selfie.expectSelfie
import org.junit.jupiter.api.Test
// spotless:on

class UT_CustomAnnotationGCTest {
  @Test fun withStandardAnnotation() {
    expectSelfie("standard").toMatchDisk()
  }

  @MyTest fun withCustomAnnotation() {
    expectSelfie("custom").toMatchDisk()
  }
}
