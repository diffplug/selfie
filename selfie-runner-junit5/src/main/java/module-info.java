module com.diffplug.selfie.junit {
    exports com.diffplug.selfie.junit5;
    requires transitive com.diffplug.selfie;

    requires kotlin.stdlib;
    requires org.junit.platform.launcher;
    requires org.junit.platform.engine;
    requires org.opentest4j;

    provides org.junit.platform.launcher.TestExecutionListener with com.diffplug.selfie.junit5.SelfieTestExecutionListenerShim;
}