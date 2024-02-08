plugins {
  id("org.jetbrains.kotlin.jvm")
}
repositories {
  mavenCentral()
}
dependencies {
  testImplementation(project(":selfie-runner-kotest"))
  testImplementation("io.kotest:kotest-runner-junit5:${project.properties["ver_KOTEST"]}")
}
tasks.test {
  useJUnitPlatform()
  environment(properties.filter { it.key == "selfie" })
  inputs.files(fileTree("src/test") {
    include("**/*.ss")
  })
}