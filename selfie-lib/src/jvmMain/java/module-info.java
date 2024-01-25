module com.diffplug.selfie {
    requires kotlin.stdlib;
    exports com.diffplug.selfie;
    exports com.diffplug.selfie.guts to com.diffplug.selfie.junit;
}