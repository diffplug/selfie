package com.example.kotest

import com.diffplug.selfie.kotest.SelfieExtension

class KotestConfig : io.kotest.core.config.AbstractProjectConfig() {
    override val extensions = listOf(SelfieExtension(this))
}