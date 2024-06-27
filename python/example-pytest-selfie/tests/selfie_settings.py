from selfie_lib import Snapshot, StringSelfie, expect_selfie
from werkzeug.test import TestResponse

REDIRECTS = {
    303: "See Other",
    302: "Found",
    307: "Temporary Redirect",
    301: "Moved Permanently",
}


def web_selfie(response: TestResponse) -> StringSelfie:
    redirect_reason = REDIRECTS.get(response.status_code)
    if redirect_reason is not None:
        actual = Snapshot.of(
            f"REDIRECT {response.status_code} {redirect_reason} to "
            + response.headers.get("Location")
        )
    else:
        actual = Snapshot.of(response.data.decode()).plus_facet(
            "status", response.status
        )
    return expect_selfie(actual)
