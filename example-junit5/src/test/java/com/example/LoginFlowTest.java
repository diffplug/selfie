package com.example;

import static com.example.MyRestAssured.get;
import static com.example.MyRestAssured.given;
import static selfie.SelfieSettings.expectSelfie;

import io.jooby.Jooby;
import io.jooby.test.JoobyTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

@JoobyTest(Dev.class)
@TestMethodOrder(MethodOrderer.MethodName.class)
public class LoginFlowTest {
  @Test
  public void loginFlow(Jooby app) {
    expectSelfie(get("/")).toMatchDisk("1) not logged in").facet("md").toBe("Please login");
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
login=user@domain.com|JclThw==;Path=/""");
    expectSelfie(given().cookie("login", "user@domain.com|JclThw==").get("/")).toMatchDisk("5) should be logged in")
        .facet("md").toBe("Welcome back user@domain.com");

    expectSelfie(given().cookie("login", "user@domain.com|badsignature").get("/")).toMatchDisk("6) bad signature should fail")
        .facets("md").toBe("""
Unauthorized

status code: 401""");
  }
}
