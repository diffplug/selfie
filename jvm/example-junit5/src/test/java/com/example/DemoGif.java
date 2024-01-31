package com.example;

import static selfie.SelfieSettings.expectSelfie;

import io.restassured.RestAssured;
import org.junit.jupiter.api.Test;

public class DemoGif {
  @Test
  void homepage() {
    expectSelfie(RestAssured.get("https://selfie.dev"));
  }
}
