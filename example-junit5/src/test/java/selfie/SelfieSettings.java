package selfie;

import com.diffplug.selfie.Camera;
import com.diffplug.selfie.CompoundLens;
import com.diffplug.selfie.Lens;
import com.diffplug.selfie.Selfie;
import com.diffplug.selfie.Snapshot;
import com.diffplug.selfie.junit5.SelfieSettingsAPI;
import com.example.EmailDev;
import com.vladsch.flexmark.html2md.converter.FlexmarkHtmlConverter;
import io.jooby.StatusCode;
import io.restassured.response.Response;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jsoup.Jsoup;

public class SelfieSettings extends SelfieSettingsAPI {
  private static final Lens htmlClean =
      new CompoundLens()
          .mutateFacet("", SelfieSettings::prettyPrintHtml)
          .replaceAllRegex("http://localhost:\\d+/", "https://www.example.com/")
          .setFacetFrom("md", "", SelfieSettings::htmlToMd);

  private static final Camera<EmailDev> EMAIL = Camera.of(SelfieSettings::cameraEmail, htmlClean);

  private static Snapshot cameraEmail(EmailDev email) {
    return Snapshot.of(email.htmlMsg)
        .plusFacet(
            "metadata", "subject=" + email.subject + "\nto=" + email.to + "\nfrom=" + email.from);
  }

  public static Selfie.DiskSelfie expectSelfie(EmailDev email) {
    return Selfie.expectSelfie(email, EMAIL);
  }

  public static Selfie.DiskSelfie expectSelfie(Response response) {
    return Selfie.expectSelfie(response, RESPONSE.withLens(htmlClean));
  }

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
        Snapshot snapshot;
        if (redirectReason != null) {
          snapshot =
              Snapshot.of(
                  "REDIRECT "
                      + response.getStatusCode()
                      + " "
                      + redirectReason
                      + " to "
                      + response.getHeader("Location"));
        } else {
          snapshot =
              Snapshot.of(response.getBody().asString())
                  .plusFacet("statusLine", response.getStatusLine());
        }
        if (response.getHeaders().hasHeaderWithName("set-cookie")) {
          var cookies = response.getHeaders().getValues("set-cookie");
          return snapshot.plusFacet("cookies", cookies.stream().collect(Collectors.joining("\n")));
        } else {
          return snapshot;
        }
      };

  // need 'org.jsoup:jsoup:1.17.1' on the test claspath
  private static String prettyPrintHtml(String html) {
    if (!html.contains("<body")) {
      return html;
    }
    var doc = Jsoup.parse(html);
    doc.outputSettings().prettyPrint(true);
    return doc.outerHtml();
  }

  // need 'com.vladsch.flexmark:flexmark-html2md-converter:0.64.8' on the test claspath
  private static String htmlToMd(String html) {
    var md =
        new FlexmarkHtmlConverter.Builder()
            .build()
            .convert(html)
            .replaceAll("(?m)^====+", "")
            .replaceAll("(?m)^\\-\\-\\-+", "")
            .replaceAll("(?m)^\\*\\*\\*[\\* ]+", "")
            .replaceAll("\n\n+", "\n\n");
    return md.trim();
  }
}
