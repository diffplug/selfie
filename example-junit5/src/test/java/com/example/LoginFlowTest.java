package com.example;

import static com.diffplug.selfie.Selfie.expectSelfie;
import static selfie.SelfieSettings.expectSelfie;

import io.jooby.Jooby;
import io.jooby.test.JoobyTest;
import io.restassured.RestAssured;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

@JoobyTest(Dev.class)
@TestMethodOrder(MethodOrderer.MethodName.class)
public class LoginFlowTest {
  @Test
  public void homepage(Jooby app) {
    expectSelfie(get("/")).toMatchDisk("1) not logged in")
        .facet("md").toBe("Please login");
    expectSelfie(given().param("email", "user@domain.com").post("/login")).toMatchDisk("2) post login form")
        .facet("md").toBe("""
Email sent!

Check your email for your login link.""");

    var email = EmailDev.waitForIncoming(app);
    expectSelfie(email).toMatchDisk("3) login email")
            .facet("md").toBe("Click [here](https://www.example.com/login-confirm/erjchFY=) to login.");

    expectSelfie(get("/login-confirm/erjchFY=")).toMatchDisk("4) open login email link")
        .facets("", "cookies").toBe("""
REDIRECT 302 Found to /
╔═ [cookies] ═╗
login=user@domain.com;Path=/""");
    expectSelfie(given().cookie("login=user@domain.com").get("/")).toMatchDisk("5) follow redirect")
            .facet("md").toBe("Welcome back user@domain.com=null");
  }

  // SELFIEWRITE
  private static RequestSpecification given() {
    return RestAssured.given().redirects().follow(false).baseUri("http://localhost:8911");
  }

  private static Response get(String url) {
    return given().get(url);
  }
}
