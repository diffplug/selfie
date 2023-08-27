package com.diffplug.selfie.junit5

import com.diffplug.selfie.expectSelfie
import kotlin.test.Test

class UT_ControlRW {
  @Test fun selfie() {
    //    expectSelfie("apple").toMatchDisk()
    expectSelfie("orange").toMatchDisk()
  }
}
