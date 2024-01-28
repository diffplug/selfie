package com.example;

import edu.umd.cs.findbugs.annotations.NonNull;
import io.jooby.Context;
import io.jooby.Cookie;
import io.jooby.Extension;
import io.jooby.Jooby;
import io.jooby.StatusCode;
import io.jooby.Value;
import io.jooby.exception.StatusCodeException;
import jakarta.mail.internet.InternetAddress;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.annotation.Nullable;

public class Account implements Extension {
  final Map<String, String> database = new ConcurrentHashMap<>();

  @Override
  public void install(@NonNull Jooby application) {
    application
        .getRouter()
        .get(
            "/",
            ctx -> {
              var user = AuthorizedUser.auth(ctx);
              if (user != null) {
                return """
<html><body>
  <h1>Welcome back USERNAME</h1>
</body></html>"""
                    .replace("USERNAME", user.email);
              } else {
                return """
<html><body>
  <h1>Please login</h1>
  <form action="/login" method="post">
    <input type="text" name="email" placeholder="email">
    <input type="submit" value="login">
  </form>
</body></html>""";
              }
            });

    application
        .getRouter()
        .post(
            "/login",
            ctx -> {
              String email = ctx.form("email").value();
              String randomCode = randomString(7, ctx.require(SecureRandom.class));
              database.put(randomCode, email);

              var loginEmail = ctx.require(Email.class);
              loginEmail.from = new InternetAddress("team@example.com");
              loginEmail.to = new InternetAddress(email);
              loginEmail.subject = "Login to example.com";
              loginEmail.htmlMsg =
                  "Click <a href=\"http://"
                      + ctx.getHostAndPort()
                      + "/login-confirm/"
                      + randomCode
                      + "\">here</a> to login.";
              loginEmail.doSend();
              return "<html><body><h1>Email sent!</h1><p>Check your email for your login link.</p></body></html>";
            });
    application
        .getRouter()
        .get(
            "/login-confirm/{code}",
            ctx -> {
              String email = database.remove(ctx.path("code").valueOrNull());
              if (email == null) {
                return "<html><body><h1>Login link expired.</h1><p>Sorry, <a href=\"/\">try again</a>.</p></body></html>";
              }
              new AuthorizedUser(email).setCookies(ctx);
              return ctx.sendRedirect(StatusCode.FOUND, "/");
            });
  }

  private static String randomString(int length, SecureRandom random) {
    int numBytes = 3 * length / 4;
    byte[] bytes = new byte[numBytes];
    random.nextBytes(bytes);
    return Base64.getUrlEncoder().encodeToString(bytes);
  }

  static class AuthorizedUser {
    final String email;

    AuthorizedUser(String email) {
      this.email = email;
    }

    static @Nullable AuthorizedUser auth(Context ctx) throws Exception {
      AuthorizedUser existing = ctx.getAttribute(REQ_LOGIN_STATUS);
      if (existing != null) {
        return existing;
      }
      Value loginCookie = ctx.cookie(LOGIN_COOKIE);
      if (loginCookie.isMissing()) {
        return null;
      }
      String cookie = loginCookie.value();
      int comma = cookie.indexOf('|');
      if (comma == -1) {
        throw new StatusCodeException(StatusCode.UNAUTHORIZED);
      }
      String email = cookie.substring(0, comma);
      String signature = cookie.substring(comma + 1);
      if (!signature.equals(signatureFor(email))) {
        throw new StatusCodeException(StatusCode.UNAUTHORIZED);
      }

      AuthorizedUser user = new AuthorizedUser(email);
      ctx.setAttribute(REQ_LOGIN_STATUS, user);
      return user;
    }

    private void setCookies(Context ctx) {
      ctx.setResponseCookie(new Cookie(LOGIN_COOKIE, email + "|" + signatureFor(email)));
    }

    private static String signatureFor(String email) {
      String terribleSecurity = "password";
      int signed = (email + terribleSecurity).hashCode();
      return Base64.getUrlEncoder().encodeToString(intToByteArray(signed));
    }

    private static final String REQ_LOGIN_STATUS = "reqLoginStatus";
    private static final String LOGIN_COOKIE = "login";

    private static byte[] intToByteArray(int value) {
      return new byte[] {
        (byte) (value >> 24), (byte) (value >> 16), (byte) (value >> 8), (byte) value
      };
    }
  }
}
