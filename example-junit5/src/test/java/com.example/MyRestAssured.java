package com.example;

import io.restassured.RestAssured;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

public class MyRestAssured {
  static RequestSpecification given() {
    return RestAssured.given().redirects().follow(false).baseUri("http://localhost:8911");
  }

  static Response get(String url) {
    return given().get(url);
  }
}
