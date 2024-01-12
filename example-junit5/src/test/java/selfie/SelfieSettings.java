package selfie;

import com.diffplug.selfie.Camera;
import com.diffplug.selfie.Selfie;
import com.diffplug.selfie.Snapshot;
import com.diffplug.selfie.junit5.SelfieSettingsAPI;
import com.example.EmailDev;
import io.jooby.StatusCode;
import io.restassured.response.Response;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class SelfieSettings extends SelfieSettingsAPI {
  public static Selfie.DiskSelfie expectSelfie(Response response) {
    return Selfie.expectSelfie(response, RESPONSE);
  }

  //  private static final Camera<Response> RESPONSE =
  //      (Response response) ->
  //          Snapshot.of(response.getBody().asString())
  //              .plusFacet("statusLine", response.getStatusLine());

  private static final Map<Integer, String> REDIRECTS =
      Stream.of(
              StatusCode.SEE_OTHER,
              StatusCode.FOUND,
              StatusCode.TEMPORARY_REDIRECT,
              StatusCode.MOVED_PERMANENTLY)
          .collect(Collectors.toMap(StatusCode::value, StatusCode::reason));
  private static final Camera<Response> RESPONSE =
      (Response response) -> {
        var redirectReason = REDIRECTS.get(response.getStatusCode());
        if (redirectReason != null) {
          return Snapshot.of(
              "REDIRECT "
                  + response.getStatusCode()
                  + " "
                  + redirectReason
                  + " to "
                  + response.getHeader("Location"));
        } else {
          return Snapshot.of(response.getBody().asString())
              .plusFacet("statusLine", response.getStatusLine());
        }
      };

  public static Selfie.DiskSelfie expectSelfie(EmailDev email) {
    return Selfie.expectSelfie(email, EMAIL);
  }

  private static final Camera<EmailDev> EMAIL =
      (EmailDev email) ->
          Snapshot.of(email.htmlMsg)
              .plusFacet(
                  "metadata",
                  "subject=" + email.subject + "\nto=" + email.to + " from=" + email.from);
}
