from selfie_lib import Camera, Snapshot, StringSelfie, expect_selfie
from werkzeug.test import TestResponse

REDIRECTS = {
    303: "See Other",
    302: "Found",
    307: "Temporary Redirect",
    301: "Moved Permanently",
}


def web_camera(response: TestResponse) -> Snapshot:
    redirect_reason = REDIRECTS.get(response.status_code)
    if redirect_reason is not None:
        return Snapshot.of(
            f"REDIRECT {response.status_code} {redirect_reason} to "
            + response.headers.get("Location", "<unknown>")
        )
    else:
        return Snapshot.of(response.data.decode()).plus_facet("status", response.status)


WEB_CAMERA = Camera.of(web_camera)


def web_selfie(response: TestResponse) -> StringSelfie:
    return expect_selfie(response, WEB_CAMERA)
