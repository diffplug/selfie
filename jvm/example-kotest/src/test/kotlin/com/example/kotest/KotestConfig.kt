package com.example.kotest

import com.diffplug.selfie.kotest.SelfieExtension

class KotestConfig : io.kotest.core.config.AbstractProjectConfig() {
    override fun extensions() = listOf(SelfieExtension)
}