import re

from bs4 import BeautifulSoup
from markdownify import markdownify as md
from selfie_lib import Camera, CompoundLens, Snapshot, StringSelfie, expect_selfie
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


def _pretty_print_html(html: str):
    return BeautifulSoup(html, "html.parser").prettify() if "<html" in html else None


def _html_to_md(html: str):
    if "<html" not in html:
        return None
    else:
        # Remove <br> tags
        clean_html = re.sub(r"<br.*?>", "", html)

        # Convert HTML to Markdown
        md_text = md(clean_html)

        # Remove specific patterns from lines
        md_text = re.sub(r"(?m)^====+", "", md_text)
        md_text = re.sub(r"(?m)^---+", "", md_text)
        md_text = re.sub(r"(?m)^\*\*\*[^\* ]+", "", md_text)

        # Replace multiple newlines with double newlines
        md_text = re.sub(r"\n\n+", "\n\n", md_text)

        # Trim each line
        trim_lines = "\n".join(line.strip() for line in md_text.split("\n"))

        return trim_lines.strip()


_HTML_LENS = (
    CompoundLens()
    .mutate_facet("", _pretty_print_html)
    .replace_all_regex("http://localhost:\\d+/", "https://demo.selfie.dev/")
    .set_facet_from("md", "", _html_to_md)
)

_WEB_CAMERA = Camera.of(_web_camera).with_lens(_HTML_LENS)


def web_selfie(response: TestResponse) -> StringSelfie:
    return expect_selfie(response, _WEB_CAMERA)
