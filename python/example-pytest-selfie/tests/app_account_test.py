import pytest
from selfie_lib import expect_selfie

from app import app, wait_for_incoming_email
from tests.selfie_settings import web_selfie


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_homepage(client):
    web_selfie(client.get("/")).to_be("""
<html><body>
  <h1>Please login</h1>
  <form action="/login" method="post">
    <input type="text" name="email" placeholder="email">
    <input type="submit" value="login">
  </form>
</body></html>
╔═ [status] ═╗
200 OK""")


def test_T01_not_logged_in(client):
    response = client.get("/")
    expect_selfie(response.data.decode()).to_be("""
<html><body>
  <h1>Please login</h1>
  <form action="/login" method="post">
    <input type="text" name="email" placeholder="email">
    <input type="submit" value="login">
  </form>
</body></html>""")


def test_T02_login(client):
    response = client.post("/login", data={"email": "user@domain.com"})
    expect_selfie(response.data.decode()).to_be("""
<html><body>
  <h1>Email sent!</h1>
  <p>Check your email for your login link.</p>
</body></html>""")

    email = wait_for_incoming_email()
    expect_selfie(email).to_be(
        {
            "to": "user@domain.com",
            "subject": "Login to example.com",
            "html_content": 'Click <a href="http://localhost/login-confirm/2Yw4aCQ">here</a> to login.',
        }
    )


def test_T03_login_confirm(client):
    response = client.get("/login-confirm/erjchFY=", follow_redirects=False)
    expect_selfie(headers_to_string(response)).to_be("""200 OK
Content-Type=text/html; charset=utf-8""")


def headers_to_string(response):
    headers = [f"{response.status}"]
    for name, value in response.headers.items():
        if name.lower() not in ["server", "date", "content-length"]:
            headers.append(f"{name}={value}")
    return "\n".join(headers)


if __name__ == "__main__":
    pytest.main()
