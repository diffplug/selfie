from bs4 import BeautifulSoup
from selfie_lib import Camera, Snapshot, StringSelfie, expect_selfie
from werkzeug.test import TestResponse

REDIRECTS = {
    303: "See Other",
    302: "Found",
    307: "Temporary Redirect",
    301: "Moved Permanently",
}


def _web_camera(response: TestResponse) -> Snapshot:
    redirect_reason = REDIRECTS.get(response.status_code)
    if redirect_reason is not None:
        return Snapshot.of(
            f"REDIRECT {response.status_code} {redirect_reason} to "
            + response.headers.get("Location", "<unknown>")
        )
    else:
        return Snapshot.of(response.data.decode()).plus_facet("status", response.status)


def _pretty_print_html(html: str) -> str:
    return BeautifulSoup(html, "html.parser").prettify()


def _pretty_print_lens(snapshot: Snapshot) -> Snapshot:
    if "<html" in snapshot.subject.value_string():
        return snapshot.plus_or_replace(
            "", _pretty_print_html(snapshot.subject.value_string())
        )
    else:
        return snapshot


WEB_CAMERA = Camera.of(_web_camera).with_lens(_pretty_print_lens)


def web_selfie(response: TestResponse) -> StringSelfie:
    return expect_selfie(response, WEB_CAMERA)
