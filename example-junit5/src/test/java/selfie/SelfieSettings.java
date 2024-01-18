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
                  "subject=" + email.subject + "\nto=" + email.to + "\nfrom=" + email.from);

  private static final Lens htmlClean =
      new CompoundLens()
          .mutateFacet("", SelfieSettings::prettyPrintHtml)
          .replaceAllRegex("http://localhost:\\d+/", "https://www.diffplug.com/")
          .setFacetFrom("md", "", SelfieSettings::htmlToMd);

  public static Selfie.DiskSelfie expectSelfie(Response response) {
    return Selfie.expectSelfie(response, RESPONSE.withLens(htmlClean));
  }

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
    if (!html.contains("<body")) {
      return html;
    }
    return new FlexmarkHtmlConverter.Builder().build().convert(html);
  }
}
