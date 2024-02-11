package com.example.kotest

import io.kotest.core.spec.style.FunSpec
import com.diffplug.selfie.coroutines.expectSelfie

class SmokeTest : FunSpec() {
    init {
        test("smoke test") {
            expectSelfie((1 to 10).toString()).toMatchDisk()
        }
    }
}