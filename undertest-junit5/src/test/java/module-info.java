module selfie.undertest.junit.test {
    requires com.diffplug.selfie.junit;
    requires com.diffplug.selfie;
    requires kotlin.test.junit5;
    requires org.junit.jupiter.api;
    requires org.junit.jupiter.params;
    opens undertest.junit5 to org.junit.platform.commons;
}