package com.example;

import static com.diffplug.selfie.Selfie.expectSelfie;
import static selfie.SelfieSettings.expectSelfie;

import io.jooby.Jooby;
import io.jooby.test.JoobyTest;
import io.restassured.RestAssured;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.util.stream.Collectors;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

@JoobyTest(Dev.class)
@TestMethodOrder(MethodOrderer.MethodName.class)
public class AccountTest {
  @Test
  public void homepage() {
    expectSelfie(get("/").body().asString())
        .toBe(
            """
<html><body>
\s <h1>Please login</h1>
\s <form action="/login" method="post">
\s   <input type="text" name="email" placeholder="email">
\s   <input type="submit" value="login">
\s </form>
</body></html>""");
  }

  @Test
  public void T01_not_logged_in() {
    expectSelfie(get("/"))
        .toBe(
            """
<html><body>
\s <h1>Please login</h1>
\s <form action="/login" method="post">
\s   <input type="text" name="email" placeholder="email">
\s   <input type="submit" value="login">
\s </form>
</body></html>
╔═ [statusLine] ═╗
HTTP/1.1 200 OK""");
  }

  @Test
  public void T02_login(Jooby app) {
    expectSelfie(given().param("email", "user@domain.com").post("/login"))
        .toBe(
            """
<html><body><h1>Email sent!</h1><p>Check your email for your login link.</p></body></html>
╔═ [statusLine] ═╗
HTTP/1.1 200 OK""");
    var email = EmailDev.waitForIncoming(app);
    expectSelfie(email)
        .toBe(
            """
Click <a href="http://localhost:8911/login-confirm/erjchFY=">here</a> to login.
╔═ [metadata] ═╗
subject=Login to example.com
to=user@domain.com from=team@example.com""");
  }

  @Test
  public void T03_login_confirm() {
    expectSelfie(headersToString(get("/login-confirm/erjchFY=")))
        .toBe(
            """
HTTP/1.1 302 Found
content-type=text/html;charset=UTF-8
set-cookie=login=user@domain.com;Path=/
location=/""");
  }

  private static String headersToString(Response response) {
    return response.statusLine()
        + "\n"
        + response.getHeaders().asList().stream()
            .map(e -> e.getName() + "=" + e.getValue())
            .filter(
                str ->
                    !str.startsWith("server=")
                        && !str.startsWith("date=")
                        && !str.startsWith("content-length="))
            .collect(Collectors.joining("\n"));
  }

  private static RequestSpecification given() {
    return RestAssured.given().redirects().follow(false).baseUri("http://localhost:8911");
  }

  private static Response get(String url) {
    return given().get(url);
  }
}
