import pytest
from selfie_lib import expect_selfie

from app import app, wait_for_incoming_email

from .selfie_settings import web_selfie


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_homepage_v1(client):
  expect_selfie(client.get("/").data.decode()).to_be("""
<html><body>
  <h1>Please login</h1>
  <form action="/login" method="post">
    <input type="text" name="email" placeholder="email">
    <input type="submit" value="login">
  </form>
</body></html>""")

def test_homepage_v2(client):
  web_selfie(client.get("/")).to_be("""<html>
 <body>
  <h1>
   Please login
  </h1>
  <form action="/login" method="post">
   <input name="email" placeholder="email" type="text"/>
   <input type="submit" value="login"/>
  </form>
 </body>
</html>

╔═ [md] ═╗
Please login
╔═ [status] ═╗
200 OK""")
    
def test_login_flow(client):
  web_selfie(client.get("/")).to_match_disk("1. not logged in") \
    .facet("md").to_be("Please login")

  web_selfie(client.post("/login", data={"email": "user@domain.com"})) \
    .to_match_disk("2. post login form") \
    .facet("md").to_be("""Email sent!

Check your email for your login link.""")

  email = wait_for_incoming_email()
  expect_selfie(email).to_be(
        {
            "to": "user@domain.com",
            "subject": "Login to example.com",
            "html_content": 'Click <a href="http://localhost/login-confirm/2Yw4aCQ">here</a> to login.',
        }
    )
  
  web_selfie(client.get("/login-confirm/2Yw4aCQ")).to_be("""REDIRECT 302 Found to /
╔═ [cookies] ═╗
login=user@domain.com|29Xwa32OsHUoHm4TRitwQMWpuynz3r1aw3BcB5pPGdY=; Path=/""")

  client.set_cookie('login', 'user@domain.com|29Xwa32OsHUoHm4TRitwQMWpuynz3r1aw3BcB5pPGdY=')
  web_selfie(client.get("/")).to_match_disk("3. log in works with cookies") \
    .facet("md").to_be("Welcome back user@domain.com")

  client.set_cookie('login', 'user@domain.com|ABCDEF')
  web_selfie(client.get("/")).to_match_disk("4. log in fails with fake cookies") \
    .facet("status").to_be("401 UNAUTHORIZED")

if __name__ == "__main__":
    pytest.main()
