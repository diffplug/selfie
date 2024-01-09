package selfie;

import com.diffplug.selfie.Camera;
import com.diffplug.selfie.Selfie;
import com.diffplug.selfie.Snapshot;
import com.diffplug.selfie.junit5.SelfieSettingsAPI;
import com.example.EmailDev;
import io.restassured.response.Response;

public class SelfieSettings extends SelfieSettingsAPI {
  @Override
  public String getSnapshotFolderName() {
    return null;
  }

  public static Selfie.DiskSelfie expectSelfie(Response response) {
    return Selfie.expectSelfie(response, RESPONSE);
  }

  public static Selfie.DiskSelfie expectSelfie(EmailDev email) {
    return Selfie.expectSelfie(email, EMAIL);
  }

  private static final Camera<Response> RESPONSE =
      (Response response) -> Snapshot.of(response.getBody().asString());

  private static final Camera<EmailDev> EMAIL = (EmailDev email) -> Snapshot.of(email.htmlMsg);
}
