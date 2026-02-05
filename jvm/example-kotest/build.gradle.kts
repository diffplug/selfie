plugins {
  id("org.jetbrains.kotlin.jvm")
}
repositories {
  mavenCentral()
}
dependencies {
  // import Kotlin API client BOM
  testImplementation(platform("com.aallam.openai:openai-client-bom:3.8.2"))
  testImplementation("com.aallam.openai:openai-client")
  testImplementation("io.ktor:ktor-client-okhttp")
  // json
  testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:${project.properties["ver_KOTLIN_SERIALIZATION"]}")
  // add kotest and its runner
  testImplementation(project(":selfie-runner-kotest"))
  testImplementation("io.kotest:kotest-runner-junit5:${project.properties["ver_KOTEST"]}")
}
tasks.test {
  useJUnitPlatform()
  systemProperty("kotest.framework.config.fqn", "com.example.kotest.KotestConfig")
  environment(properties.filter { it.key == "selfie" || it.key == "OPENAI_API_KEY" })
  inputs.files(fileTree("src/test") {
    include("**/*.ss")
  })
}