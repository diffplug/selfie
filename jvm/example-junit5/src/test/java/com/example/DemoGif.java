package com.example;

import static selfie.SelfieSettings.expectSelfie;

import io.restassured.RestAssured;
import org.junit.jupiter.api.Test;

public class DemoGif {
  @Test
  void homepage() {
    // see .github/demo.gif
    RestAssured.given();
    expectSelfie(RestAssured.get("/"));
  }
}
